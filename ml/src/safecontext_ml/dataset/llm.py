"""LLM backend: Claude writes realistic "Macrohard" documents with inline span tags.

Nothing is sent unless you pass `--yes`; without it the command only reports how many requests
it would make. Every response is cached under `ml/data/raw/llm-cache/`, so re-running is free and
the dataset can be rebuilt from the cache alone.

Backends (`--backend`): `api` (the Anthropic API; **costs money**, `ANTHROPIC_API_KEY`) or
`claude-cli` (the local `claude -p` on the user's Claude Code login: no API spend, no key; see
`safecontext_ml/claude_cli.py`). CLI responses are cached under `llm-cache/claude-cli/<model>/`.

How it works:
1. Scenarios are planned deterministically: (genre, index) -> scenario id -> split.
2. Entity values (customers, people, codenames, secrets...) are pre-sampled from that split's
   pools, so test entities never appear in train, and handed to the model to use verbatim.
3. The model returns the document with `<data-type-id>...</data-type-id>` tags (see `markup.py`).
4. Quality gates reject a response if the markup is broken, a hard negative contains the labels it
   should avoid, or a provided sensitive value appears in the text without a tag.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import sys
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import labels as L
from . import values as V
from .markup import MarkupError, parse
from .paths import LLM_CACHE_DIR
from .schema import Record, Span, validate
from .split import Split, assign_split

SOURCE = "macrohard-llm"
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_EFFORT = "medium"
MAX_TOKENS = 4096
#: Part of the cache key. Bump it only to deliberately pay for fresh responses after a prompt
#: change that makes old ones wrong. Rewording alone doesn't invalidate the cache (see cache_path).
PROMPT_VERSION = 1
#: Rough per-request token use, for the cost estimate printed before a run.
EST_INPUT_TOKENS, EST_OUTPUT_TOKENS = 1_800, 900


@dataclass(frozen=True)
class LlmGenre:
    name: str
    brief: str
    #: Labels the document should usually contain (empty for public genres).
    focus: tuple[str, ...]
    #: Share of scenarios written as safe look-alikes (hard negatives).
    negative_share: float


GENRES: tuple[LlmGenre, ...] = (
    LlmGenre("slack-thread", "a Slack thread between Macrohard employees (3-12 messages, `name: message` lines)",
             (L.CUSTOMER, L.DEAL, L.METRICS, L.ROADMAP, L.SECRET), 0.3),
    LlmGenre("incident-log", "an incident timeline or postmortem for a Macrohard service outage",
             (L.METRICS, L.SECRET, L.PERSONAL, L.CUSTOMER), 0.2),
    LlmGenre("support-ticket", "a customer support ticket and the agent's reply",
             (L.PERSONAL, L.CUSTOMER, L.DEAL), 0.2),
    LlmGenre("launch-review", "internal launch review notes for an upcoming Macrohard product",
             (L.ROADMAP, L.METRICS, L.REVENUE, L.CUSTOMER), 0.2),
    LlmGenre("finance-update", "an internal finance or board update",
             (L.REVENUE, L.METRICS, L.DEAL, L.CUSTOMER), 0.2),
    LlmGenre("sales-notes", "sales pipeline or deal-desk notes",
             (L.CUSTOMER, L.DEAL, L.PERSONAL), 0.2),
    LlmGenre("code", "a source file, config file, shell session or diff from a Macrohard repository",
             (L.SECRET, L.PERSONAL), 0.4),
    LlmGenre("press-release", "a public Macrohard press release about a product that has already launched", (), 1.0),
    LlmGenre("release-notes", "public release notes or a changelog for a shipped Macrohard product", (), 1.0),
    LlmGenre("public-docs", "public developer documentation for the Macrohard API", (), 1.0),
)  # fmt: skip

SYSTEM_PROMPT = """\
You write realistic synthetic documents for training a data-loss-prevention classifier. They \
come from "Macrohard", a fictional software company. Every name, number and secret is invented.

Wrap every sensitive span in a tag named after its data type id, for example \
<customer-names>Bluefin Logistics</customer-names>. The data types are:
{types}

Tagging rules:
- Tag the smallest span that carries the value: the number with its currency, magnitude and unit \
("$4.2M", "18%", "340 ms", "3,412"), not the surrounding words.
- unreleased-roadmap: codenames of unreleased products and planned dates of unreleased launches. \
A product that already shipped publicly, or a date announced publicly, is not tagged.
- customer-personal-data: names and contact details (email, phone, card number, postal address, \
IP address) of customers or end users. Macrohard employees' names and chat handles are not tagged.
- secrets: the secret value only (key, token, password, private key block, or a whole \
connection string that contains a password), never the variable name.
- Placeholders ("<YOUR_API_KEY>"), environment variable names, example.com addresses, masked \
values ("card ending 4242"), public prices and public statistics are safe: do not tag them.
- Tag every occurrence. Never nest tags. Use no other tags or markup for spans.

Output only the document itself, with tags. No preamble, no code fences around the whole \
document, no commentary."""


def _types_block() -> str:
    return "\n".join(
        f"- {L.BY_ID[t].id}: {L.BY_ID[t].description}" for t in L.SPAN_LABELS
    )


@dataclass(frozen=True)
class Scenario:
    id: str
    genre: LlmGenre
    split: Split
    hard_negative: bool
    #: label -> values the model should use verbatim.
    values: dict[str, list[str]]
    length: str
    seed: int = 0

    def user_prompt(self) -> str:
        lines = [f"Write {self.genre.brief}. Length: {self.length}."]
        if self.hard_negative:
            lines.append(
                "This one must be SAFE: it should look like the kind of document that could leak "
                "data, but contain nothing sensitive. Use public facts, shipped products, placeholders, "
                "env var names, example.com addresses and public numbers instead. It must contain "
                "no tags at all."
            )
        else:
            lines.append(
                "Include several sensitive spans, mostly of these types: "
                + ", ".join(self.genre.focus)
                + ". Mix in safe look-alikes too (public numbers, shipped products, placeholders)."
            )
        if self.values:
            lines.append(
                "Use these exact values when you need one of these types (you may skip some):"
            )
            for label, vals in self.values.items():
                lines.append(f"- {label}: " + "; ".join(vals))
        lines.append(f"Safe facts you may use: shipped products {', '.join(V.PRODUCTS[:4])}; staff handles "
                     f"{', '.join(V.STAFF[:6])}; company domain {V.COMPANY_DOMAIN}.")  # fmt: skip
        return "\n".join(lines)


def plan(n_per_genre: int, seed: int = 0) -> list[Scenario]:
    scenarios: list[Scenario] = []
    for genre in GENRES:
        for i in range(n_per_genre):
            sid = f"mh-llm-{genre.name}-{i:05d}"
            split = assign_split(sid)
            rng = random.Random(f"{seed}:{sid}")
            hard_negative = rng.random() < genre.negative_share
            vals: dict[str, list[str]] = {}
            if not hard_negative:
                vals = {
                    L.CUSTOMER: sorted(
                        {V.customer(rng, split) for _ in range(rng.randint(1, 3))}
                    ),
                    L.ROADMAP: [V.codename(rng, split), V.future_date(rng, split)],
                    L.PERSONAL: [
                        V.person(rng, split),
                        V.email(rng, split),
                        V.phone(rng, split),
                    ],
                    L.SECRET: [V.secret(rng, split)],
                }
                if genre.name in ("code", "incident-log"):
                    vals[L.SECRET].append(V.db_url(rng, split))
                if genre.name in ("support-ticket", "sales-notes"):
                    vals[L.PERSONAL] += [V.address(rng, split), V.card(rng, split)]
            length = rng.choice(
                (
                    "about 80 words",
                    "about 150 words",
                    "about 250 words",
                    "about 350 words",
                )
            )
            scenarios.append(
                Scenario(sid, genre, split, hard_negative, vals, length, seed)
            )
    return scenarios


def request_params(s: Scenario, model: str, effort: str) -> dict[str, Any]:
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT.format(types=_types_block()),
        "messages": [{"role": "user", "content": s.user_prompt()}],
        "output_config": {"effort": effort},
    }


def _sha256(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


def cache_path(s: Scenario, model: str, effort: str, backend: str = "api") -> Path:
    """Cache file for a scenario. The key leaves out the prompt text on purpose, so rewording a
    data type description or the system prompt doesn't throw away paid responses. Bump
    PROMPT_VERSION to regenerate on purpose."""
    key = _sha256(
        {
            "scenario": s.id,
            "seed": s.seed,
            "model": model,
            "effort": effort,
            "max_tokens": MAX_TOKENS,
            "prompt_version": PROMPT_VERSION,
        }
    )
    base = LLM_CACHE_DIR if backend == "api" else LLM_CACHE_DIR / backend
    return base / model / f"{key}.json"


BACKENDS = ("api", "claude-cli")


def _call(params: dict[str, Any], backend: str = "api") -> dict[str, Any]:
    if backend == "claude-cli":
        from .. import claude_cli

        out = claude_cli.call(params)
        out["prompt_sha256"] = _sha256(params)
        return out
    import anthropic  # imported lazily so the offline pipeline never needs it

    client = anthropic.Anthropic(max_retries=5)
    # Refusal fallback: if the model declines, the API re-runs on Anthropic's recommended fallback.
    resp = client.beta.messages.create(
        **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return {
        "params": params,
        "prompt_sha256": _sha256(params),
        "served_by": resp.model,
        "stop_reason": resp.stop_reason,
        "text": text,
        "usage": {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
        },
    }


def _whole_word(text: str, start: int, end: int) -> bool:
    return not (start > 0 and text[start - 1].isalnum()) and not (
        end < len(text) and text[end].isalnum()
    )


def repair_untagged(
    text: str, spans: list[Span], values: dict[str, list[str]]
) -> tuple[list[Span], int]:
    """Tag the occurrences of provided values that the model left untagged.

    Claude sometimes leaves the first mention of a codename or customer untagged (a heading,
    "Macrohard Quasar"). We know those values are sensitive and their label, so each whole-word
    occurrence that no span touches gets a span with the provided label. Longest values first;
    an occurrence that overlaps any span is left alone (the checks in `to_record` decide).
    Returns the new sorted spans and how many were added."""
    out = list(spans)
    added = 0
    pairs = sorted(
        ((label, v) for label, vals in values.items() for v in vals),
        key=lambda p: -len(p[1]),
    )
    for label, v in pairs:
        for m in re.finditer(re.escape(v), text):
            a, b = m.span()
            if not _whole_word(text, a, b) or any(sp.start < b and a < sp.end for sp in out):
                continue
            out.append(Span(a, b, label, v))
            added += 1
    return sorted(out, key=lambda sp: sp.start), added


def to_record(
    s: Scenario, cached: dict[str, Any], repair: bool = False
) -> tuple[Record | None, str]:
    """Parse a cached response into a record, or return (None, reason).

    `repair` (`--repair-untagged`): tag provided values the model left untagged
    (`repair_untagged`) and accept a provided value that a span of the same label partly covers
    ("Project <unreleased-roadmap>Heron</unreleased-roadmap>"), instead of rejecting the
    response. Hard negatives and mislabelled values are still rejected."""
    if cached["stop_reason"] != "end_turn":
        return None, f"stop_reason={cached['stop_reason']}"
    try:
        text, spans = parse(cached["text"].strip())
    except MarkupError as e:
        return None, f"markup: {e}"
    present = {sp.label for sp in spans}
    negative_for = sorted(set(L.SPAN_LABELS) - present) if s.hard_negative else []
    if s.hard_negative and spans:
        return None, "hard negative contains tags"
    repaired = 0
    if repair and s.values:
        spans, repaired = repair_untagged(text, spans, s.values)
    # Every provided sensitive value that made it into the text must be tagged, with its own label.
    for label, vals in s.values.items():
        for v in vals:
            start = text.find(v)
            while start != -1:
                covering = [
                    sp for sp in spans if sp.start <= start and start + len(v) <= sp.end
                ]
                if not covering and repair:
                    covering = [
                        sp for sp in spans if sp.start < start + len(v) and start < sp.end
                    ]
                    if not covering and not _whole_word(text, start, start + len(v)):
                        start = text.find(v, start + 1)  # part of a longer word
                        continue
                if not covering:
                    return None, f"untagged value {v[:30]!r}"
                if covering[0].label != label:
                    return None, f"mislabelled value {v[:30]!r} as {covering[0].label}"
                start = text.find(v, start + 1)
    rec = Record(
        id=s.id,
        text=text,
        spans=spans,
        source=SOURCE,
        group=s.id,
        genre=s.genre.name,
        negative_for=negative_for,
        meta={
            "backend": "llm",
            "model": cached["params"]["model"],
            "served_by": cached["served_by"],
            # The split whose entity pools the values came from (train pools: the tier 1 model
            # may have seen those names in training; dev/test pools: it hasn't).
            "pools": s.split,
            **({"repaired_spans": repaired} if repair else {}),
        },
    )
    errors = validate(rec)
    return (None, "; ".join(errors)) if errors else (rec, "")


def run(
    n_per_genre: int,
    model: str = DEFAULT_MODEL,
    effort: str = DEFAULT_EFFORT,
    seed: int = 0,
    yes: bool = False,
    dry_run: bool = False,
    max_requests: int | None = None,
    workers: int = 4,
    backend: str = "api",
    stats: dict[str, Any] | None = None,
    repair: bool = False,
) -> Iterator[Record]:
    """Send the uncached requests (only with `yes`), then yield a record per usable cached
    response. `stats`, if given, is filled at the end: responses, kept, rejected reasons."""
    if backend not in BACKENDS:
        raise ValueError(f"backend must be one of {BACKENDS}, not {backend!r}")
    scenarios = plan(n_per_genre, seed)
    todo = []
    for s in scenarios:
        if not cache_path(s, model, effort, backend).exists():
            todo.append((s, request_params(s, model, effort)))
    if max_requests is not None:
        todo = todo[:max_requests]

    if dry_run:
        for s, params in todo[:3]:
            print(
                f"--- {s.id} ({s.split}) ---\n{params['messages'][0]['content']}\n",
                file=sys.stderr,
            )
        print(
            f"[dry run] system prompt:\n{request_params(scenarios[0], model, effort)['system']}\n",
            file=sys.stderr,
        )
    if todo and not yes:
        cost = (
            len(todo) * (EST_INPUT_TOKENS * 2 + EST_OUTPUT_TOKENS * 10) / 1e6
        )  # Sonnet 5.5 $/MTok
        cost_s = (
            "no API spend: claude -p on your Claude Code login"
            if backend == "claude-cli"
            else f"rough cost ${cost:,.2f} at Sonnet 5.5 list prices"
        )
        print(
            f"{len(todo)} uncached requests to {model} via {backend} would be sent "
            f"({cost_s}). Re-run with --yes to send them. "
            "Using cached responses only.",
            file=sys.stderr,
        )
    elif todo:

        def work(item: tuple[Scenario, dict[str, Any]]) -> None:
            s, params = item
            out = _call(params, backend)
            path = cache_path(s, model, effort, backend)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
            )

        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, _ in enumerate(pool.map(work, todo), 1):
                if i % 25 == 0 or i == len(todo):
                    print(f"  {i}/{len(todo)} requests done", file=sys.stderr)

    rejected: dict[str, int] = {}
    rejections: list[dict[str, str]] = []
    stale = kept = 0
    for s in scenarios:
        path = cache_path(s, model, effort, backend)
        if not path.exists():
            continue
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("prompt_sha256") != _sha256(request_params(s, model, effort)):
            stale += 1
        rec, reason = to_record(s, cached, repair)
        if rec is None:
            key = reason.split(" ")[0].split("=")[0].rstrip(":")
            rejected[key] = rejected.get(key, 0) + 1
            rejections.append({"id": s.id, "reason": reason})
            continue
        kept += 1
        yield rec
    if stale:
        print(
            f"{stale} cached responses were made with an older prompt; they are still used. "
            "Bump PROMPT_VERSION to pay for fresh ones.",
            file=sys.stderr,
        )
    if rejected:
        print(f"rejected responses: {rejected}", file=sys.stderr)
    if stats is not None:
        stats.update(
            responses=kept + len(rejections),
            kept=kept,
            rejected=dict(sorted(rejected.items())),
            rejections=rejections,
            stale_prompt=stale,
        )
