"""Tier 2 context judgement on top of earlier tiers' spans (issue #14).

    tier2:RUNTIME:MODEL,base=PREDICTIONS.jsonl[,labels=a+b][,url=URL][,few_shot=0][,timeout=S]

- `base`: a predictions file from tier 0/1 (`--save-predictions`), e.g. the tier 1 ONNX run.
- For each document, the base spans whose label is in `labels` (default: `tasks.context.labels`
  in `prompts/tier2/tier2.json`: roadmap, revenue, metrics, deals) go to the local LLM in one
  call (or one per excerpt for long texts). Spans it judges not sensitive are dropped; every
  other base span is returned unchanged.
- A failed call (runtime error, bad JSON, timeout) keeps the spans: tier 2 can only remove
  false positives, never lose a span by failing.
- `predict()` is timed by the harness, so latency is the tier 2 time per document (0 for
  documents with nothing to judge). `warnings()` adds the per-call latency and the counts.

Examples:

    tier2:ollama:qwen3.5:4b-q4_K_M,base=results/preds/tier1-mh-test.jsonl
    tier2:mlx:mlx-community/Qwen3.5-4B-4bit,base=results/preds/tier1-mh-test.jsonl
"""

from __future__ import annotations

from pathlib import Path

from ...dataset.schema import Record
from ..classifier import AdapterContext, Classifier, Doc, Prediction
from ..metrics import percentile
from .predictions_file import PredictionsFile


class Tier2Context(Classifier):
    def __init__(
        self,
        runtime_spec: str,
        base: Path,
        labels: tuple[str, ...] | None = None,
        url: str = "",
        few_shot: bool = True,
        timeout_s: float | None = None,
        records: list[Record] | None = None,
    ) -> None:
        from ...tier2 import prompts as P
        from ...tier2.client import Runtime

        self.runtime = Runtime.parse(runtime_spec, base_url=url)
        self.base = PredictionsFile(base)
        self.judged_labels = labels or tuple(P.manifest()["tasks"]["context"]["labels"])
        self.few_shot = few_shot
        self.timeout_s = timeout_s
        model = self.runtime.model.replace("/", "_").replace(":", "-")
        self.name = f"tier2-{self.runtime.kind}-{model}{'' if few_shot else '-0shot'}-on-{base.stem}"
        self.labels = self.base.labels
        self.reset_stats()

    def setup(self) -> None:
        # Load the model (untimed): one tiny call, so the first timed call isn't a cold start.
        from ...tier2 import calls
        from ...tier2.prompts import SpanRef

        calls.judge_context(
            self.runtime,
            "Project X ships soon.",
            [SpanRef(0, 9, "unreleased-roadmap")],
            timeout_s=300,
        )

    def reset_stats(self) -> None:
        from ...tier2.calls import CallLog

        self.log = CallLog()
        self.judged = 0
        self.cleared = 0
        self.kept_on_failure = 0

    def predict(self, doc: Doc) -> list[Prediction]:
        from ...tier2 import calls
        from ...tier2.prompts import SpanRef

        base = self.base.predict(doc)
        todo = [p for p in base if p.label in self.judged_labels]
        if not todo:
            return base
        # Spans sent together must not overlap; merge-free: keep the first of any overlap.
        refs: dict[SpanRef, list[Prediction]] = {}
        last_end = -1
        for p in sorted(todo, key=lambda p: (p.start, -p.end)):
            if p.start < last_end:
                refs[next(reversed(refs))].append(p)
                continue
            refs[SpanRef(p.start, p.end, p.label)] = [p]
            last_end = p.end
        verdicts = calls.judge_context(
            self.runtime,
            doc.text,
            list(refs),
            log=self.log,
            timeout_s=self.timeout_s,
            few_shot=self.few_shot,
        )
        drop: set[int] = set()
        for ref, verdict in verdicts.items():
            self.judged += 1
            if verdict is None:
                self.kept_on_failure += 1
            elif verdict is False:
                self.cleared += 1
                drop.update(id(p) for p in refs[ref])
        return [p for p in base if id(p) not in drop]

    def warnings(self) -> list[str]:
        lat = [c.elapsed_ms for c in self.log.calls]
        out = [
            f"tier 2 ({self.runtime.label}): {len(self.log.calls)} calls, "
            f"{self.judged} spans judged, {self.cleared} cleared, "
            f"{self.kept_on_failure} kept because the call failed {self.log.failures or ''}".rstrip()
        ]
        if lat:
            toks = [c.completion_tokens for c in self.log.calls if c.completion_tokens]
            out.append(
                f"tier 2 latency per call: p50 {percentile(lat, 50):.0f} ms, p95 {percentile(lat, 95):.0f} ms, "
                f"max {max(lat):.0f} ms; mean output {sum(toks) / max(1, len(toks)):.0f} tokens"
            )
        return out


def factory(arg: str | None, ctx: AdapterContext) -> Classifier:
    if not arg:
        raise ValueError(
            "usage: tier2:RUNTIME:MODEL,base=PREDICTIONS.jsonl (see eval/adapters/tier2.py)"
        )
    spec, *opts = arg.split(",")
    kw = dict(o.split("=", 1) for o in opts)
    if "base" not in kw:
        raise ValueError("tier2 needs base=PREDICTIONS.jsonl (tier 0/1 spans to judge)")
    return Tier2Context(
        spec,
        Path(kw["base"]),
        labels=tuple(kw["labels"].split("+")) if kw.get("labels") else None,
        url=kw.get("url", ""),
        few_shot=kw.get("few_shot", "1") not in ("0", "false", "no"),
        timeout_s=float(kw["timeout"]) if kw.get("timeout") else None,
        records=ctx.records,
    )
