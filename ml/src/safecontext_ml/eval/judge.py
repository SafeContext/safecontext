"""Task-preservation score: does Claude still solve the task from the cleaned text?

COSTS MONEY. Opt-in with `--judge N`; nothing is sent unless you also pass `--yes`. Without
`--yes` the harness prints how many requests it would send and a rough cost, and scores only
items whose responses are already cached.

For each judged record (3 requests):
1. Claude answers a genre-appropriate task (summarise, triage, review...) on the **original** text.
2. Claude answers the same task on the **cleaned** text (predicted spans replaced by consistent
   placeholders such as `[customer-names 1]`, see `clean_text`).
3. A judge compares the two answers and scores 1-5 whether the cleaned answer still does the job,
   not penalising placeholders where exact sensitive values used to be.

Records whose cleaned text equals the original are skipped (trivially preserved, not paid for).
Responses are cached in `data/raw/judge-cache/<model>/<sha256 of request>.json`, so reruns
are free.

`clean_text` is a stand-in for the real transformations (generalize, pseudonymize, mask,
block; tier 2, not built yet): it pseudonymizes every predicted span.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..dataset.paths import RAW_DIR
from ..dataset.schema import Record
from .classifier import Prediction

DEFAULT_MODEL = "claude-sonnet-5-5"
ANSWER_EFFORT = "low"
JUDGE_EFFORT = "medium"
ANSWER_MAX_TOKENS = 2048
JUDGE_MAX_TOKENS = 2048
JUDGE_CACHE_DIR = RAW_DIR / "judge-cache"

#: List prices in $ per million tokens (input, output), October 2026. For the estimate only.
PRICES: dict[str, tuple[float, float]] = {
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
#: Rough token budget for the estimate: ~4 characters per token, plus prompt overhead, and
#: output including thinking.
CHARS_PER_TOKEN = 4
PROMPT_OVERHEAD_TOKENS = 150
EST_ANSWER_OUTPUT_TOKENS = 600
EST_JUDGE_OUTPUT_TOKENS = 500

ANSWER_SYSTEM = (
    "You are an assistant helping an employee of a software company with a document they "
    "pasted. Some values in the document may have been replaced by placeholders in square "
    "brackets, such as [customer-names 1]; treat each placeholder as an opaque value and use "
    "it as written. Answer concisely."
)

DEFAULT_TASK = "Summarise this document in 3-5 bullet points, then list any follow-up actions it calls for."
#: The task Claude is asked to do, by record genre.
TASKS: dict[str, str] = {
    "slack-thread": "Summarise this Slack thread: the decisions made, open questions and who owns each next step.",
    "incident-log": "Write a short incident summary: impact, root cause, timeline and remaining action items.",
    "support-ticket": "Draft a reply to the customer that resolves or progresses their issue, and list what the agent should do next.",
    "launch-review": "Summarise this launch review: what is launching, when, the risks and the open decisions.",
    "finance-update": "Summarise the key numbers and trends in this update and what they mean for the business.",
    "sales-notes": "Summarise this deal: the customer's needs, the deal status, and the next steps.",
    "code": "Explain what this code does and point out any bugs or security problems.",
    "press-release": "Summarise this announcement in 3 bullet points for an internal newsletter.",
    "release-notes": "Summarise what changed in this release and who should care.",
    "public-docs": "Explain what this documentation describes and give one example of using it.",
    "public-pii": "Summarise this document in 2-3 sentences, then list any action the reader needs to take.",
}

JUDGE_SYSTEM = (
    "You grade whether an assistant's answer still does the job when parts of its input were "
    "hidden. You are given a task, the original document, a reference answer written from the "
    "original, and a candidate answer written from a version of the document where some values "
    "were replaced by placeholders like [customer-names 1]. Placeholders appearing in the "
    "candidate instead of the exact values are expected and are not a fault. Judge whether the "
    "candidate still accomplishes the task: the same structure, conclusions, actions and "
    "reasoning a user would need. Penalise answers that are confused by the placeholders, miss "
    "points the reference makes, or become useless because essential non-sensitive context was "
    "removed.\n\nScore 5 = as useful as the reference; 4 = minor loss; 3 = noticeably weaker but "
    "usable; 2 = mostly fails the task; 1 = fails the task. `preserved` is true for scores 4-5."
)

JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reason": {"type": "string"},
        "score": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "preserved": {"type": "boolean"},
    },
    "required": ["reason", "score", "preserved"],
    "additionalProperties": False,
}


def clean_text(text: str, preds: Sequence[Prediction]) -> str:
    """Replace predicted spans with placeholders, numbered consistently per (label, value)."""
    spans = sorted(preds, key=lambda p: (p.start, -(p.end - p.start)))
    merged: list[Prediction] = []
    for p in spans:
        if merged and p.start < merged[-1].end:
            last = merged[-1]
            if p.end > last.end:
                merged[-1] = Prediction(last.start, p.end, last.label)
            continue
        merged.append(p)
    ids: dict[tuple[str, str], int] = {}
    per_label: dict[str, int] = {}
    out, pos = [], 0
    for p in merged:
        value = text[p.start : p.end]
        key = (p.label, value)
        if key not in ids:
            per_label[p.label] = per_label.get(p.label, 0) + 1
            ids[key] = per_label[p.label]
        out.append(text[pos : p.start])
        out.append(f"[{p.label} {ids[key]}]")
        pos = p.end
    out.append(text[pos:])
    return "".join(out)


@dataclass
class JudgeItem:
    record_id: str
    source: str
    genre: str
    task: str
    original: str
    cleaned: str


def select(
    records: Sequence[Record],
    preds_by_id: Mapping[str, Sequence[Prediction]],
    n: int,
    seed: int = 0,
) -> list[JudgeItem]:
    """Pick up to n records whose text the classifier changed, round-robin across sources."""
    by_source: dict[str, list[JudgeItem]] = {}
    for r in records:
        preds = preds_by_id.get(r.id, ())
        if not preds:
            continue
        cleaned = clean_text(r.text, preds)
        if cleaned == r.text:
            continue
        task = TASKS.get(r.genre, DEFAULT_TASK)
        by_source.setdefault(r.source, []).append(
            JudgeItem(r.id, r.source, r.genre, task, r.text, cleaned)
        )
    rng = random.Random(seed)
    queues = []
    for source in sorted(by_source):
        items = by_source[source]
        rng.shuffle(items)
        queues.append(items)
    picked: list[JudgeItem] = []
    while len(picked) < n and any(queues):
        for q in queues:
            if q and len(picked) < n:
                picked.append(q.pop())
    return picked


def answer_params(task: str, document: str, model: str) -> dict[str, Any]:
    return {
        "model": model,
        "max_tokens": ANSWER_MAX_TOKENS,
        "system": ANSWER_SYSTEM,
        "messages": [
            {
                "role": "user",
                "content": f"<document>\n{document}\n</document>\n\n{task}",
            }
        ],
        "output_config": {"effort": ANSWER_EFFORT},
    }


def judge_params(
    item: JudgeItem, reference: str, candidate: str, model: str
) -> dict[str, Any]:
    content = (
        f"<task>\n{item.task}\n</task>\n\n"
        f"<original_document>\n{item.original}\n</original_document>\n\n"
        f"<reference_answer>\n{reference}\n</reference_answer>\n\n"
        f"<candidate_answer>\n{candidate}\n</candidate_answer>"
    )
    return {
        "model": model,
        "max_tokens": JUDGE_MAX_TOKENS,
        "system": JUDGE_SYSTEM,
        "messages": [{"role": "user", "content": content}],
        "output_config": {
            "effort": JUDGE_EFFORT,
            "format": {"type": "json_schema", "schema": JUDGE_SCHEMA},
        },
    }


def cache_path(params: dict[str, Any]) -> Path:
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    return JUDGE_CACHE_DIR / params["model"] / f"{key}.json"


def _call(
    params: dict[str, Any],
) -> dict[str, Any]:  # pragma: no cover - paid, never in tests
    import anthropic  # lazily, so scoring never needs it

    client = anthropic.Anthropic(max_retries=5)
    # Refusal fallback: if the model declines, the API re-runs on Anthropic's recommended fallback.
    resp = client.beta.messages.create(
        **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
    )
    return {
        "params": params,
        "served_by": resp.model,
        "stop_reason": resp.stop_reason,
        "text": "".join(b.text for b in resp.content if b.type == "text"),
        "usage": {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
        },
    }


def _cached(params: dict[str, Any]) -> dict[str, Any] | None:
    path = cache_path(params)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _fetch(params: dict[str, Any], send: bool) -> dict[str, Any] | None:
    hit = _cached(params)
    if hit is not None or not send:
        return hit
    out = _call(params)
    path = cache_path(params)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def _tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN + PROMPT_OVERHEAD_TOKENS


def estimate(items: Sequence[JudgeItem], model: str) -> tuple[int, float | None]:
    """(uncached requests, rough cost in $ or None if the model's price is unknown)."""
    requests, tok_in, tok_out = 0, 0, 0
    for it in items:
        answers = []
        for doc in (it.original, it.cleaned):
            hit = _cached(answer_params(it.task, doc, model))
            if hit is None:
                requests += 1
                tok_in += _tokens(doc) + _tokens(it.task)
                tok_out += EST_ANSWER_OUTPUT_TOKENS
            answers.append(hit)
        judged = (
            all(answers)
            and _cached(judge_params(it, answers[0]["text"], answers[1]["text"], model))
            is not None
        )
        if not judged:
            requests += 1
            tok_in += (
                _tokens(it.original)
                + 2 * EST_ANSWER_OUTPUT_TOKENS
                + _tokens(JUDGE_SYSTEM)
            )
            tok_out += EST_JUDGE_OUTPUT_TOKENS
    price = PRICES.get(model)
    cost = None if price is None else (tok_in * price[0] + tok_out * price[1]) / 1e6
    return requests, cost


@dataclass
class JudgeResult:
    record_id: str
    source: str
    genre: str
    score: int | None = None
    preserved: bool | None = None
    reason: str = ""
    error: str = ""


@dataclass
class JudgeSummary:
    model: str
    selected: int
    sent: bool
    uncached_requests: int
    est_cost: float | None
    results: list[JudgeResult] = field(default_factory=list)

    @property
    def scored(self) -> list[JudgeResult]:
        return [r for r in self.results if r.score is not None]

    def mean_score(self, source: str | None = None) -> float | None:
        s = [r.score for r in self.scored if source is None or r.source == source]
        return sum(s) / len(s) if s else None  # type: ignore[arg-type]

    def preserved_rate(self, source: str | None = None) -> float | None:
        s = [r.preserved for r in self.scored if source is None or r.source == source]
        return sum(bool(x) for x in s) / len(s) if s else None

    def to_json(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "selected": self.selected,
            "sent": self.sent,
            "uncached_requests": self.uncached_requests,
            "est_cost_usd": self.est_cost,
            "scored": len(self.scored),
            "mean_score": self.mean_score(),
            "preserved_rate": self.preserved_rate(),
            "results": [asdict(r) for r in self.results],
        }


def _judge_one(item: JudgeItem, model: str, send: bool) -> JudgeResult:
    res = JudgeResult(item.record_id, item.source, item.genre)
    ref = _fetch(answer_params(item.task, item.original, model), send)
    cand = _fetch(answer_params(item.task, item.cleaned, model), send)
    if ref is None or cand is None:
        res.error = "not cached"
        return res
    for name, a in (("reference", ref), ("candidate", cand)):
        if a.get("stop_reason") == "refusal":
            res.error = f"{name} answer refused"
            return res
    verdict = _fetch(judge_params(item, ref["text"], cand["text"], model), send)
    if verdict is None:
        res.error = "not cached"
        return res
    try:
        data = json.loads(verdict["text"])
        res.score = int(data["score"])
        res.preserved = bool(data["preserved"])
        res.reason = str(data.get("reason", ""))
    except (KeyError, ValueError, TypeError) as e:
        res.error = f"bad judge output: {e}"
    return res


def run(
    items: Sequence[JudgeItem],
    model: str = DEFAULT_MODEL,
    yes: bool = False,
    workers: int = 4,
) -> JudgeSummary:
    requests, cost = estimate(items, model)
    cost_s = "unknown (no price for this model)" if cost is None else f"~${cost:,.2f}"
    summary = JudgeSummary(
        model,
        len(items),
        sent=bool(yes and requests),
        uncached_requests=requests,
        est_cost=cost,
    )
    if requests and not yes:
        print(
            f"judge: {requests} uncached requests to {model} would be sent for {len(items)} "
            f"records (rough cost {cost_s}). Re-run with --yes to send them. "
            "Scoring cached responses only.",
            file=sys.stderr,
        )
    elif requests:
        print(
            f"judge: sending up to {requests} requests to {model} ({cost_s})",
            file=sys.stderr,
        )
    with ThreadPoolExecutor(max_workers=workers) as pool:
        summary.results = list(pool.map(lambda it: _judge_one(it, model, yes), items))
    return summary
