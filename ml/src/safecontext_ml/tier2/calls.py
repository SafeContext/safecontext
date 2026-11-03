"""Tier 2 calls as the agent will make them: context judgement and generalize for one text.

Both cut long texts into excerpts (`prompts.excerpts`), send one chat call per excerpt, check
the answer against the task's schema, and report failures instead of raising, so the caller
applies the fallback from `tier2.json` (keep the span flagged / deterministic rewrite).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from . import prompts as P
from .client import ChatResult, Runtime, RuntimeCallError


@dataclass
class CallLog:
    """Every call made, for latency and failure counts."""

    calls: list[ChatResult] = field(default_factory=list)
    failures: dict[str, int] = field(default_factory=dict)

    def fail(self, why: str) -> None:
        key = why.split(":")[0][:60]
        self.failures[key] = self.failures.get(key, 0) + 1

    @property
    def n_failed(self) -> int:
        return sum(self.failures.values())


def _settings(task: str) -> tuple[int, int, int, float]:
    m = P.manifest()
    t = m["tasks"][task]
    ex = m["excerpts"]
    return (
        t["max_tokens"],
        ex["context_chars"],
        ex["max_chars"],
        m["timeouts"]["per_call_ms"] / 1000,
    )


def _run(
    task: str,
    runtime: Runtime,
    text: str,
    spans: Sequence[P.SpanRef],
    data_types: Mapping[str, P.DataTypeInfo] | None,
    log: CallLog,
    timeout_s: float | None,
    few_shot: bool,
) -> dict[P.SpanRef, dict]:
    max_tokens, context_chars, max_chars, default_timeout = _settings(task)
    schema = P.load_task(task).schema
    out: dict[P.SpanRef, dict] = {}
    for ex in P.excerpts(text, spans, context_chars, max_chars):
        req = P.build_request(task, ex.text, ex.spans, data_types, ex.offset, few_shot)
        try:
            res = runtime.chat(
                req.messages, schema, max_tokens, timeout_s or default_timeout
            )
        except RuntimeCallError as e:
            log.fail(f"runtime: {e}")
            continue
        log.calls.append(res)
        if res.finish_reason == "length":
            log.fail("answer cut off (max_tokens)")
            continue
        try:
            answer = P.parse_answer(task, res.text, req.ids)
        except P.ResponseError as e:
            log.fail(f"bad answer: {e}")
            continue
        for sid, ref in req.spans.items():
            out[ref] = answer[sid]
    return out


def judge_context(
    runtime: Runtime,
    text: str,
    spans: Sequence[P.SpanRef],
    data_types: Mapping[str, P.DataTypeInfo] | None = None,
    log: CallLog | None = None,
    timeout_s: float | None = None,
    few_shot: bool = True,
) -> dict[P.SpanRef, bool | None]:
    """{span: sensitive?}. None = no valid answer for that span (caller keeps it flagged)."""
    log = log if log is not None else CallLog()
    got = _run("context", runtime, text, spans, data_types, log, timeout_s, few_shot)
    return {s: (bool(got[s]["sensitive"]) if s in got else None) for s in spans}


def generalize(
    runtime: Runtime,
    text: str,
    spans: Sequence[P.SpanRef],
    data_types: Mapping[str, P.DataTypeInfo] | None = None,
    log: CallLog | None = None,
    timeout_s: float | None = None,
    few_shot: bool = True,
) -> dict[P.SpanRef, str | None]:
    """{span: rewrite}. None = no valid answer for that span (caller falls back)."""
    log = log if log is not None else CallLog()
    got = _run("generalize", runtime, text, spans, data_types, log, timeout_s, few_shot)
    return {s: (got[s]["text"].strip() if s in got else None) for s in spans}
