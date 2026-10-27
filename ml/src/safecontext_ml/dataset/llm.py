"""LLM backend: Claude writes realistic "Macrohard" documents with inline span tags.

COSTS MONEY. Nothing is sent unless you pass `--yes`; without it the command only reports how many
requests it would make. Every response is cached under `ml/data/raw/llm-cache/`, so re-running is
free and the dataset can be rebuilt from the cache alone.

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
from .schema import Record, validate
from .split import Split, assign_split

SOURCE = "macrohard-llm"
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_EFFORT = "medium"
MAX_TOKENS = 4096
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
            scenarios.append(Scenario(sid, genre, split, hard_negative, vals, length))
    return scenarios


def request_params(s: Scenario, model: str, effort: str) -> dict[str, Any]:
    return {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT.format(types=_types_block()),
        "messages": [{"role": "user", "content": s.user_prompt()}],
        "output_config": {"effort": effort},
    }


def cache_path(params: dict[str, Any]) -> Path:
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    return LLM_CACHE_DIR / params["model"] / f"{key}.json"


def _call(params: dict[str, Any]) -> dict[str, Any]:
    import anthropic  # imported lazily so the offline pipeline never needs it

    client = anthropic.Anthropic(max_retries=5)
    # Refusal fallback: if the model declines, the API re-runs on Anthropic's recommended fallback.
    resp = client.beta.messages.create(
        **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return {
        "params": params,
        "served_by": resp.model,
        "stop_reason": resp.stop_reason,
        "text": text,
        "usage": {
            "input_tokens": resp.usage.input_tokens,
            "output_tokens": resp.usage.output_tokens,
        },
    }


def to_record(s: Scenario, cached: dict[str, Any]) -> tuple[Record | None, str]:
    """Parse a cached response into a record, or return (None, reason)."""
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
    # Every provided sensitive value that made it into the text must be tagged.
    tagged = {(sp.start, sp.end) for sp in spans}
    for vals in s.values.values():
        for v in vals:
            start = text.find(v)
            while start != -1:
                if not any(a <= start and start + len(v) <= b for a, b in tagged):
                    return None, f"untagged value {v[:30]!r}"
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
) -> Iterator[Record]:
    scenarios = plan(n_per_genre, seed)
    todo = []
    for s in scenarios:
        params = request_params(s, model, effort)
        if not cache_path(params).exists():
            todo.append((s, params))
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
        print(
            f"{len(todo)} uncached requests to {model} would be sent "
            f"(rough cost ${cost:,.2f} at Sonnet 5.5 list prices). Re-run with --yes to send them. "
            "Using cached responses only.",
            file=sys.stderr,
        )
    elif todo:

        def work(item: tuple[Scenario, dict[str, Any]]) -> None:
            _s, params = item
            out = _call(params)
            path = cache_path(params)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
            )

        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, _ in enumerate(pool.map(work, todo), 1):
                if i % 25 == 0 or i == len(todo):
                    print(f"  {i}/{len(todo)} requests done", file=sys.stderr)

    rejected: dict[str, int] = {}
    for s in scenarios:
        path = cache_path(request_params(s, model, effort))
        if not path.exists():
            continue
        rec, reason = to_record(s, json.loads(path.read_text(encoding="utf-8")))
        if rec is None:
            key = reason.split(":")[0].split("=")[0]
            rejected[key] = rejected.get(key, 0) + 1
            continue
        yield rec
    if rejected:
        print(f"rejected responses: {rejected}", file=sys.stderr)
