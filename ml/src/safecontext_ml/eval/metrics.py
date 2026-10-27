"""Scoring: per-label precision / recall / F1, red recall, false-positive rates, latency.

Span-matching rule (documented in ml/README.md, "Evaluation"):

1. **Clean the predictions.** Drop spans with bad offsets (start >= end, outside the text) and
   exact duplicates. Then drop any prediction that overlaps an `ignore` region **and** no gold
   span: the source dataset marked that text sensitive but we have no data type for it, so it
   is neither right nor wrong. (A prediction that also covers a gold span is kept.)
2. **Overlap match (headline numbers).** A gold span is *found* if at least one prediction with
   the **same label** shares at least one character with it. A prediction is *correct* if it
   shares at least one character with a gold span of the same label. Precision = correct
   predictions / predictions; recall = found gold spans / gold spans. Not one-to-one: one
   prediction covering two gold spans finds both, which matches what redaction needs (both
   values are hidden).
3. **Exact match (reported alongside).** A prediction is a true positive only if its
   (start, end, label) equals a gold span's.
4. **Red recall** = found red gold spans / red gold spans, using the overlap rule.
   "Any label" also counts a red span as found when a prediction of a *different* label covers
   it (the text is still hidden, but the wrong policy action may apply).
5. **Safe-text false-positive rate** = records with no gold spans that get at least one
   prediction / records with no gold spans.
6. **Hard-negative false-positive rate** = hard-negative records (non-empty `negative_for`) with
   at least one prediction whose label is in that record's `negative_for` / hard-negative
   records. Per label in the per-label table.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from ..dataset import RED_LABELS, SPAN_LABELS
from ..dataset.schema import Record, Span
from .classifier import Prediction


def _overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def _overlaps_any(p: Prediction, spans: Iterable[Span]) -> bool:
    return any(_overlaps(p.start, p.end, s.start, s.end) for s in spans)


@dataclass
class LabelCounts:
    gold: int = 0
    pred: int = 0
    #: Overlap rule: gold spans found, predictions that hit a gold span.
    gold_found: int = 0
    pred_correct: int = 0
    #: Exact (start, end, label) matches.
    exact_tp: int = 0
    #: Hard-negative records built to look like this label, and those predicted with it.
    hn_records: int = 0
    hn_flagged: int = 0

    def add(self, other: LabelCounts) -> None:
        for k in self.__dataclass_fields__:
            setattr(self, k, getattr(self, k) + getattr(other, k))

    @property
    def precision(self) -> float | None:
        return self.pred_correct / self.pred if self.pred else None

    @property
    def recall(self) -> float | None:
        return self.gold_found / self.gold if self.gold else None

    @property
    def f1(self) -> float | None:
        return f1(self.precision, self.recall)

    @property
    def exact_f1(self) -> float | None:
        p = self.exact_tp / self.pred if self.pred else None
        r = self.exact_tp / self.gold if self.gold else None
        return f1(p, r)


def f1(p: float | None, r: float | None) -> float | None:
    if p is None or r is None:
        return None
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)


@dataclass
class RecordResult:
    labels: dict[str, LabelCounts]
    red_gold: int
    red_found_any: int
    safe: bool
    flagged: bool
    hard_negative: bool
    hn_flagged: bool
    dropped_ignore: int
    dropped_invalid: int
    kept: list[Prediction]


def clean_predictions(
    record: Record, preds: Sequence[Prediction]
) -> tuple[list[Prediction], int, int]:
    """Step 1 of the matching rule. Returns (kept, dropped_invalid, dropped_ignore)."""
    n = len(record.text)
    seen: set[tuple[int, int, str]] = set()
    valid: list[Prediction] = []
    invalid = 0
    for p in preds:
        key = (p.start, p.end, p.label)
        if not (0 <= p.start < p.end <= n) or p.label not in SPAN_LABELS:
            invalid += 1
            continue
        if key in seen:
            continue
        seen.add(key)
        valid.append(p)
    kept = [
        p
        for p in valid
        if not (_overlaps_any(p, record.ignore) and not _overlaps_any(p, record.spans))
    ]
    return kept, invalid, len(valid) - len(kept)


def score_record(record: Record, preds: Sequence[Prediction]) -> RecordResult:
    kept, invalid, ignored = clean_predictions(record, preds)
    labels = {label: LabelCounts() for label in SPAN_LABELS}
    gold_keys = {(s.start, s.end, s.label) for s in record.spans}

    for s in record.spans:
        c = labels[s.label]
        c.gold += 1
        if any(
            p.label == s.label and _overlaps(p.start, p.end, s.start, s.end)
            for p in kept
        ):
            c.gold_found += 1
    for p in kept:
        c = labels[p.label]
        c.pred += 1
        if any(
            s.label == p.label and _overlaps(p.start, p.end, s.start, s.end)
            for s in record.spans
        ):
            c.pred_correct += 1
        if (p.start, p.end, p.label) in gold_keys:
            c.exact_tp += 1

    red = [s for s in record.spans if s.label in RED_LABELS]
    red_found_any = sum(
        1 for s in red if any(_overlaps(p.start, p.end, s.start, s.end) for p in kept)
    )

    predicted_labels = {p.label for p in kept}
    for label in record.negative_for:
        labels[label].hn_records += 1
        if label in predicted_labels:
            labels[label].hn_flagged += 1

    return RecordResult(
        labels=labels,
        red_gold=len(red),
        red_found_any=red_found_any,
        safe=not record.spans,
        flagged=bool(kept),
        hard_negative=bool(record.negative_for),
        hn_flagged=bool(predicted_labels & set(record.negative_for)),
        dropped_ignore=ignored,
        dropped_invalid=invalid,
        kept=kept,
    )


def percentile(values: Sequence[float], q: float) -> float | None:
    """Nearest-rank percentile (q in 0..100)."""
    if not values:
        return None
    s = sorted(values)
    k = max(0, min(len(s) - 1, math.ceil(q / 100 * len(s)) - 1))
    return s[k]


@dataclass
class GroupScores:
    """Totals for one group of records: everything, or one source."""

    records: int = 0
    labels: dict[str, LabelCounts] = field(
        default_factory=lambda: {label: LabelCounts() for label in SPAN_LABELS}
    )
    red_found_any: int = 0
    safe_records: int = 0
    safe_flagged: int = 0
    hn_records: int = 0
    hn_flagged: int = 0
    dropped_ignore: int = 0
    dropped_invalid: int = 0
    latencies_ms: list[float] = field(default_factory=list)
    chars: int = 0

    def add(self, record: Record, r: RecordResult, latency_ms: float | None) -> None:
        self.records += 1
        self.chars += len(record.text)
        for label, c in r.labels.items():
            self.labels[label].add(c)
        self.red_found_any += r.red_found_any
        self.safe_records += r.safe
        self.safe_flagged += r.safe and r.flagged
        self.hn_records += r.hard_negative
        self.hn_flagged += r.hn_flagged
        self.dropped_ignore += r.dropped_ignore
        self.dropped_invalid += r.dropped_invalid
        if latency_ms is not None:
            self.latencies_ms.append(latency_ms)

    def total(self, labels: Iterable[str] = SPAN_LABELS) -> LabelCounts:
        t = LabelCounts()
        for label in labels:
            t.add(self.labels[label])
        return t

    @property
    def red_recall(self) -> float | None:
        return self.total(RED_LABELS).recall

    @property
    def red_recall_any(self) -> float | None:
        gold = self.total(RED_LABELS).gold
        return self.red_found_any / gold if gold else None

    @property
    def safe_fp_rate(self) -> float | None:
        return self.safe_flagged / self.safe_records if self.safe_records else None

    @property
    def hn_fp_rate(self) -> float | None:
        return self.hn_flagged / self.hn_records if self.hn_records else None

    def latency(self, q: float) -> float | None:
        return percentile(self.latencies_ms, q)

    def to_json(self) -> dict:
        micro = self.total()
        return {
            "records": self.records,
            "chars": self.chars,
            "red_recall": self.red_recall,
            "red_recall_any_label": self.red_recall_any,
            "micro": {
                "precision": micro.precision,
                "recall": micro.recall,
                "f1": micro.f1,
            },
            "safe_records": self.safe_records,
            "safe_flagged": self.safe_flagged,
            "safe_fp_rate": self.safe_fp_rate,
            "hard_negative_records": self.hn_records,
            "hard_negative_flagged": self.hn_flagged,
            "hard_negative_fp_rate": self.hn_fp_rate,
            "dropped_ignore": self.dropped_ignore,
            "dropped_invalid": self.dropped_invalid,
            "latency_ms": {
                "n": len(self.latencies_ms),
                "p50": self.latency(50),
                "p95": self.latency(95),
            },
            "labels": {
                label: {
                    **{k: getattr(c, k) for k in c.__dataclass_fields__},
                    "precision": c.precision,
                    "recall": c.recall,
                    "f1": c.f1,
                    "exact_f1": c.exact_f1,
                }
                for label, c in self.labels.items()
            },
        }


OVERALL = "overall"


class Scorer:
    """Accumulates results overall and per source."""

    def __init__(self) -> None:
        self.groups: dict[str, GroupScores] = {OVERALL: GroupScores()}

    def add(
        self, record: Record, preds: Sequence[Prediction], latency_ms: float | None
    ) -> RecordResult:
        r = score_record(record, preds)
        self.groups[OVERALL].add(record, r, latency_ms)
        self.groups.setdefault(record.source, GroupScores()).add(record, r, latency_ms)
        return r

    @property
    def overall(self) -> GroupScores:
        return self.groups[OVERALL]

    def sources(self) -> list[str]:
        # Macrohard first (the only source of the business labels), then by size.
        names = [k for k in self.groups if k != OVERALL]
        return sorted(
            names,
            key=lambda s: (not s.startswith("macrohard"), -self.groups[s].records, s),
        )
