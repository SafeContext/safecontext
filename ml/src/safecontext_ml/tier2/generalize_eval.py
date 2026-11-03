"""Generalize evaluation: are the rewrites vague, true, short and leak-free? (issue #14)

    python -m safecontext_ml.tier2 generalize ollama:qwen3.5:4b-q4_K_M --split test
    python -m safecontext_ml.tier2 generalize rules --split test        # deterministic baseline

Input: the **gold** spans of the generalize data types (revenue figures, internal metrics, deal
sizes by default) in Macrohard records, so the score is about rewriting, not detection. One call
per record with all its values, as the agent would send them.

Checks per value, none of which needs Claude:
- **answered**: the call succeeded and the JSON matched the schema
- **format**: one line, 1-60 characters, at most 6 words, no markup/brackets/quotes, not the
  original text
- **leak**: the rewrite repeats the value (`numbers.leaks_value`: the span text, its digits, or
  the same number written another way)
- **too precise**: a number with 2+ significant digits within 5% of the value ("about 13,000"
  for 12,946)
- **entity leak**: another sensitive value from the same record (a customer, codename, person,
  or another number) appears in the rewrite
- **true**: the interval the rewrite claims ("high teens", "over $1M", "low six figures")
  contains the value (`numbers.is_true`); "unverified" when no rule understands the wording
- **clean** = answered, format ok, no leak of any kind, and not known to be false

`--judge N` prepares the Claude task-preservation score on N records (the document with these
rewrites, other sensitive values as placeholders) and, without `--yes`, only counts the calls.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..dataset import labels as L
from ..dataset.paths import ML_ROOT, SPLITS_DIR, split_path
from ..dataset.schema import Record, read_jsonl
from ..eval import judge as J
from ..eval.metrics import percentile
from . import numbers as N
from .calls import CallLog, generalize
from .client import Runtime
from .prompts import SpanRef, manifest

RESULTS_DIR = ML_ROOT / "results"
DEFAULT_LABELS = (L.REVENUE, L.METRICS, L.DEAL)
MAX_WORDS = 6
MAX_CHARS = 60


@dataclass
class Item:
    record_id: str
    label: str
    original: str
    rewrite: str | None
    answered: bool = False
    format_ok: bool = False
    leak: bool = False
    too_precise: bool = False
    entity_leak: bool = False
    true: bool | None = None

    @property
    def clean(self) -> bool:
        return (
            self.answered
            and self.format_ok
            and not (self.leak or self.too_precise or self.entity_leak)
            and self.true is not False
        )


def check_format(rewrite: str, original: str) -> bool:
    r = rewrite.strip()
    return (
        0 < len(r) <= MAX_CHARS
        and "\n" not in r
        and len(r.split()) <= MAX_WORDS
        and not re.search(r"[<>\[\]{}\"“”]", r)
        and r.lower() != original.strip().lower()
    )


#: Words a vague rewrite of a name may share with it ("Bluefin Logistics" -> "a logistics
#: customer"): generic company and project words, not the distinctive part of the name.
GENERIC_WORDS = frozenset(
    [
        "project",
        "the",
        "and",
        "of",
        "for",
        "inc",
        "ltd",
        "llc",
        "corp",
        "company",
        "group",
        "labs",
        "systems",
        "partners",
        "logistics",
        "health",
        "bank",
        "foods",
        "retail",
        "insurance",
        "energy",
        "pharma",
        "credit",
        "union",
        "airlines",
        "media",
    ]
)


def _tokens(text: str) -> set[str]:
    """Distinctive words of a non-numeric value: 3+ characters, not in `GENERIC_WORDS`. Month
    names and day numbers of a date count, so "in March" leaks "March 3"."""
    return {
        t
        for t in re.findall(r"[a-z0-9]+", text.lower())
        if (len(t) >= 3 or t.isdigit()) and t not in GENERIC_WORDS
    }


def check(item: Item, others: Sequence[str]) -> Item:
    """Fill in the checks for one rewrite. `others`: the record's other sensitive span texts."""
    if item.rewrite is None:
        return item
    r = item.rewrite
    item.answered = True
    item.format_ok = check_format(r, item.original)
    val = N.parse_value(item.original)
    if val is not None:
        item.leak = N.leaks_value(r, val, item.original)
        item.too_precise = not item.leak and N.too_precise(r, val)
        item.true = N.is_true(r, val)
    else:
        item.leak = item.original.strip().lower() in r.lower() or bool(
            _tokens(item.original) & _tokens(r)
        )
    low = r.lower()
    item.entity_leak = any(
        len(o.strip()) >= 3 and o.strip().lower() in low
        for o in others
        if o != item.original
    )
    return item


@dataclass
class Summary:
    model: str
    split: str
    records: int
    items: list[Item] = field(default_factory=list)
    latencies_ms: list[float] = field(default_factory=list)
    failures: dict[str, int] = field(default_factory=dict)
    judge: J.JudgeSummary | None = None

    def rows(self) -> list[tuple[str, list[Item]]]:
        labels = sorted(
            {i.label for i in self.items}, key=lambda x: L.SPAN_LABELS.index(x)
        )
        return [("all", self.items)] + [
            (lab, [i for i in self.items if i.label == lab]) for lab in labels
        ]

    def to_json(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "split": self.split,
            "records": self.records,
            "failures": self.failures,
            "latency_ms": {
                "p50": percentile(self.latencies_ms, 50),
                "p95": percentile(self.latencies_ms, 95),
                "calls": len(self.latencies_ms),
            },
            "items": [asdict(i) | {"clean": i.clean} for i in self.items],
            "judge": None if self.judge is None else self.judge.to_json(),
        }


def _pct(n: int, d: int) -> str:
    return "–" if d == 0 else f"{100 * n / d:.1f}%"


def render(s: Summary, command: str) -> str:
    lines = [
        f"# Generalize: `{s.model}` on `{s.split}`",
        "",
        f"- **Command:** `{command}`",
        f"- **Date:** {datetime.now(UTC):%Y-%m-%d %H:%M UTC}",
        f"- **Values:** {len(s.items)} gold spans in {s.records} Macrohard records; one call per record",
        "- **Checks:** `ml/src/safecontext_ml/tier2/generalize_eval.py` (no Claude). *True* is over the values whose rewrite the heuristic could check.",
    ]
    if s.latencies_ms:
        lines.append(
            f"- **Latency per call:** p50 {percentile(s.latencies_ms, 50):.0f} ms, "
            f"p95 {percentile(s.latencies_ms, 95):.0f} ms ({len(s.latencies_ms)} calls)"
        )
    if s.failures:
        lines.append(f"- **Failed calls:** {s.failures}")
    lines += [
        "",
        "| Data type | Values | Answered | Format ok | Leak | Too precise | Entity leak | Checkable | True (of checkable) | **Clean** |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, items in s.rows():
        n = len(items)
        ans = [i for i in items if i.answered]
        checkable = [i for i in ans if i.true is not None]
        lines.append(
            f"| {name if name == 'all' else f'`{name}`'} | {n} | {_pct(len(ans), n)} | "
            f"{_pct(sum(i.format_ok for i in ans), n)} | {_pct(sum(i.leak for i in ans), n)} | "
            f"{_pct(sum(i.too_precise for i in ans), n)} | {_pct(sum(i.entity_leak for i in ans), n)} | "
            f"{_pct(len(checkable), n)} | {_pct(sum(bool(i.true) for i in checkable), len(checkable))} | "
            f"**{_pct(sum(i.clean for i in items), n)}** |"
        )
    if s.judge is not None:
        j = s.judge
        lines += [
            "",
            "## Task preservation (Claude judge)",
            "",
            f"`{j.model}` via {'`claude -p`' if j.backend == 'claude-cli' else 'the API'}: "
            f"{j.selected} records selected, {len(j.scored)} scored"
            + (
                f"; **not sent**: {j.uncached_requests} requests would be sent (re-run with `--yes`)."
                if j.uncached_requests and not j.sent
                else "."
            ),
        ]
        if j.scored:
            lines.append(
                f"Mean score {j.mean_score():.2f} / 5; preserved (4-5): {100 * (j.preserved_rate() or 0):.1f}%."
            )
    return "\n".join(lines) + "\n"


def select(records: Sequence[Record], labels: Sequence[str]) -> list[Record]:
    return [
        r
        for r in records
        if r.source.startswith("macrohard") and any(s.label in labels for s in r.spans)
    ]


def apply_rewrites(record: Record, rewrites: dict[tuple[int, int], str]) -> str:
    """The record's text with rewrites applied and every other gold span as a placeholder."""
    out, pos = [], 0
    ids: dict[tuple[str, str], int] = {}
    per: dict[str, int] = {}
    for sp in record.spans:
        out.append(record.text[pos : sp.start])
        r = rewrites.get((sp.start, sp.end))
        if r is not None:
            out.append(r)
        else:
            key = (sp.label, sp.text)
            if key not in ids:
                per[sp.label] = per.get(sp.label, 0) + 1
                ids[key] = per[sp.label]
            out.append(f"[{sp.label} {ids[key]}]")
        pos = sp.end
    out.append(record.text[pos:])
    return "".join(out)


def run(
    model: str,
    split: str = "test",
    labels: Sequence[str] = DEFAULT_LABELS,
    limit: int | None = None,
    url: str = "",
    few_shot: bool = True,
    judge_n: int = 0,
    judge_model: str = J.DEFAULT_MODEL,
    judge_backend: str = "claude-cli",
    yes: bool = False,
    splits_dir: Path = SPLITS_DIR,
) -> Summary:
    records = select(list(read_jsonl(split_path(split, splits_dir))), labels)
    if limit is not None:
        records = records[:limit]
    s = Summary(model, split, len(records))
    log = CallLog()
    runtime = None if model == "rules" else Runtime.parse(model, base_url=url)
    if runtime is not None:  # load the model (untimed)
        generalize(
            runtime, "Revenue was $1.2M.", [SpanRef(12, 17, L.REVENUE)], timeout_s=300
        )
    judge_items: list[J.JudgeItem] = []
    for i, r in enumerate(records, 1):
        spans = [sp for sp in r.spans if sp.label in labels]
        refs = [SpanRef(sp.start, sp.end, sp.label) for sp in spans]
        if runtime is None:
            got = {ref: N.rule_rewrite(r.text[ref.start : ref.end]) for ref in refs}
        else:
            got = generalize(runtime, r.text, refs, log=log, few_shot=few_shot)
        others = [sp.text for sp in r.spans]
        for sp, ref in zip(spans, refs, strict=True):
            s.items.append(check(Item(r.id, sp.label, sp.text, got.get(ref)), others))
        if judge_n:
            rewrites = {
                (ref.start, ref.end): v for ref, v in got.items() if v is not None
            }
            cleaned = apply_rewrites(r, rewrites)
            if cleaned != r.text:
                judge_items.append(
                    J.JudgeItem(
                        r.id,
                        r.source,
                        r.genre,
                        J.TASKS.get(r.genre, J.DEFAULT_TASK),
                        r.text,
                        cleaned,
                    )
                )
        if i % 50 == 0:
            print(f"  {i}/{len(records)} records", file=sys.stderr)
    s.latencies_ms = [c.elapsed_ms for c in log.calls]
    s.failures = log.failures
    if judge_n:
        # Spread the judged records across genres, deterministically.
        by_genre: dict[str, list[J.JudgeItem]] = {}
        for it in judge_items:
            by_genre.setdefault(it.genre, []).append(it)
        picked: list[J.JudgeItem] = []
        queues = [by_genre[g] for g in sorted(by_genre)]
        while len(picked) < judge_n and any(queues):
            for q in queues:
                if q and len(picked) < judge_n:
                    picked.append(q.pop(0))
        s.judge = J.run(picked, judge_model, yes=yes, backend=judge_backend)
    return s


def save(s: Summary, command: str, out_dir: Path = RESULTS_DIR) -> Path:
    name = re.sub(
        r"[^A-Za-z0-9._-]+", "-", f"tier2-generalize-{s.model}-{s.split}"
    ).strip("-")
    out_dir.mkdir(parents=True, exist_ok=True)
    md = out_dir / f"{name}.md"
    md.write_text(render(s, command), encoding="utf-8")
    data = s.to_json() | {"command": command, "prompt_version": manifest()["version"]}
    (out_dir / f"{name}.json").write_text(
        json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    return md
