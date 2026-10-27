"""Render a run as a markdown report."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..dataset.labels import BY_ID
from .judge import JudgeSummary
from .metrics import OVERALL, GroupScores, Scorer

RED_RECALL_TARGET = 0.95


def pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.1f}%"


def ms(x: float | None) -> str:
    return "–" if x is None else (f"{x:.2f}" if x < 10 else f"{x:.0f}")


def frac(k: int, n: int) -> str:
    return "–" if not n else f"{pct(k / n)} ({k:,}/{n:,})"


@dataclass
class RunInfo:
    model: str
    split: str
    split_sha256: str
    manifest_sha256: str | None
    records_in_split: int
    sampling: str
    command: str
    date: str
    machine: str
    model_labels: tuple[str, ...]
    latency_source: str
    warnings: list[str] = field(default_factory=list)


def _headline(scorer: Scorer, info: RunInfo) -> list[str]:
    cols = [OVERALL, *scorer.sources()]
    g = [scorer.groups[c] for c in cols]

    def row(name: str, f) -> str:
        return f"| {name} | " + " | ".join(f(x) for x in g) + " |"

    def red(x: GroupScores) -> str:
        r = x.red_recall
        if r is None:
            return "–"
        mark = "✅" if r >= RED_RECALL_TARGET else "❌"
        return f"{pct(r)} {mark}"

    lines = [
        "| Metric | " + " | ".join(cols) + " |",
        "| --- | " + " | ".join("---:" for _ in cols) + " |",
        row("Records", lambda x: f"{x.records:,}"),
        row("Gold spans", lambda x: f"{x.total().gold:,}"),
        row("Predicted spans", lambda x: f"{x.total().pred:,}"),
        row(f"**Red recall** (target ≥ {RED_RECALL_TARGET:.0%})", red),
        row("Red recall, any label", lambda x: pct(x.red_recall_any)),
        row("Micro precision", lambda x: pct(x.total().precision)),
        row("Micro recall", lambda x: pct(x.total().recall)),
        row("Micro F1", lambda x: pct(x.total().f1)),
        row(
            "**Safe text flagged** (FP rate)",
            lambda x: frac(x.safe_flagged, x.safe_records),
        ),
        row("**Hard negatives flagged**", lambda x: frac(x.hn_flagged, x.hn_records)),
        row("Latency p50 (ms)", lambda x: ms(x.latency(50))),
        row("Latency p95 (ms)", lambda x: ms(x.latency(95))),
        row(
            "Mean chars / record",
            lambda x: f"{x.chars / x.records:,.0f}" if x.records else "–",
        ),
        row("Predictions dropped (ignore regions)", lambda x: f"{x.dropped_ignore:,}"),
    ]
    return lines


def _labels_table(g: GroupScores, model_labels: tuple[str, ...]) -> list[str]:
    lines = [
        "| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, c in g.labels.items():
        if not (c.gold or c.pred or c.hn_records):
            continue
        name = f"`{label}`" + ("" if label in model_labels else " *")
        lines.append(
            f"| {name} | {BY_ID[label].tier} | {c.gold:,} | {c.pred:,} | {pct(c.precision)} | "
            f"{pct(c.recall)} | {pct(c.f1)} | {pct(c.exact_f1)} | {frac(c.hn_flagged, c.hn_records)} |"
        )
    return lines


def _judge_section(j: JudgeSummary | None, sources: list[str]) -> list[str]:
    if j is None:
        return [
            (
                "Not run. It is paid and opt-in: `--judge N` picks N records the model changed and "
                "prints a cost estimate; add `--yes` to send the requests."
            ),
        ]
    lines = [
        f"Model `{j.model}`. {j.selected} records selected, {len(j.scored)} scored."
        + (
            ""
            if j.sent or not j.uncached_requests
            else f" **Not sent:** {j.uncached_requests} uncached requests"
            + ("" if j.est_cost is None else f", roughly ${j.est_cost:,.2f}")
            + "; re-run with `--yes` to send them."
        ),
        "",
    ]
    if j.scored:
        lines += [
            "| | Overall | " + " | ".join(sources) + " |",
            "| --- | ---: | " + " | ".join("---:" for _ in sources) + " |",
            "| Mean score (1-5) | "
            + " | ".join(
                "–" if (m := j.mean_score(s)) is None else f"{m:.2f}"
                for s in (None, *sources)
            )
            + " |",
            "| Preserved (score 4-5) | "
            + " | ".join(pct(j.preserved_rate(s)) for s in (None, *sources))
            + " |",
        ]
    errors = [r for r in j.results if r.error and r.error != "not cached"]
    if errors:
        lines += [
            "",
            f"{len(errors)} items failed: "
            + "; ".join(f"{r.record_id}: {r.error}" for r in errors[:5]),
        ]
    return lines


def render(scorer: Scorer, info: RunInfo, judge: JudgeSummary | None) -> str:
    manifest_note = ""
    if info.manifest_sha256 and info.manifest_sha256 != info.split_sha256:
        manifest_note = " ⚠️ differs from `manifest.json`"
    out = [
        f"# Evaluation: `{info.model}` on `{info.split}`",
        "",
        (
            f"- **Data:** `{info.split}.jsonl`, sha256 `{info.split_sha256[:16]}…`{manifest_note}; "
            f"{scorer.overall.records:,} of {info.records_in_split:,} records ({info.sampling})"
        ),
        f"- **Command:** `{info.command}`",
        f"- **Date:** {info.date} · **Machine:** {info.machine}",
        f"- **Latency:** {info.latency_source}",
        (
            "- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* "
            "column); predictions that only touch `ignore` regions are dropped. Rules: "
            "`ml/README.md`, Evaluation."
        ),
    ]
    out += [f"- ⚠️ {w}" for w in info.warnings]
    out += [
        "",
        (
            "Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the "
            "five business labels come only from Macrohard, so read the per-source columns."
        ),
        "",
        "## Headline",
        "",
        *_headline(scorer, info),
        "",
        "## Per label, all sources",
        "",
        *_labels_table(scorer.overall, info.model_labels),
    ]
    for s in scorer.sources():
        out += [
            "",
            f"## Per label: {s}",
            "",
            *_labels_table(scorer.groups[s], info.model_labels),
        ]
    if any(label not in info.model_labels for label in scorer.overall.labels):
        out += ["", "\\* not predicted by this model: recall is 0 by design."]
    out += [
        "",
        "## Task preservation (LLM judge)",
        "",
        *_judge_section(judge, scorer.sources()),
        "",
    ]
    return "\n".join(out)
