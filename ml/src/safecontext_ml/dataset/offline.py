"""Offline backend: builds "Macrohard" documents from templates. No network, no cost, deterministic.

Good for plumbing, smoke tests and a first score. Its variety is limited (a fixed snippet bank),
so treat scores on it as an upper bound; the LLM backend (`llm.py`) is the real training data.
"""

from __future__ import annotations

import random
from collections.abc import Iterator
from dataclasses import dataclass

from .banks import Snippet, bank_for_split
from .render import DocBuilder
from .schema import Record
from .split import Split, assign_split

SOURCE = "macrohard-offline"


@dataclass(frozen=True)
class Genre:
    name: str
    headers: tuple[str, ...]
    #: (bank, weight) pairs; snippets are drawn from these.
    banks: tuple[tuple[str, float], ...]
    k: tuple[int, int]
    #: Prefix for each snippet: "%d" becomes a speaker number (1-3), "%i" the line number.
    prefixes: tuple[str, ...] = ("",)
    joiner: str = "\n"
    footers: tuple[str, ...] = ("",)


GENRES: tuple[Genre, ...] = (
    Genre(
        "slack-thread",
        headers=("", "#{{service}}\n", "Thread in #deals\n"),
        banks=(("chat", 0.55), ("chat_neutral", 0.45)),
        k=(2, 7),
        prefixes=("{{staff#%d}}: ", "[{{clock#%i}}] {{staff#%d}}: ", "@{{staff#%d}} "),
    ),
    Genre(
        "incident-log",
        headers=(
            "INC-{{ticket}}: {{service}} degraded\nSeverity: SEV{{small_int}}\n\nTimeline\n",
            "Incident {{ticket}} - {{service}} outage\n",
            "Postmortem draft: {{service}}\n\n",
        ),
        banks=(("incident", 1.0),),
        k=(3, 6),
        prefixes=("{{clock#%i}} UTC  ", "- "),
    ),
    Genre(
        "support-ticket",
        headers=(
            "Ticket #{{ticket}}\nFrom: {{person}} <{{email}}>\nCompany: {{customer}}\nSubject: Billing problem\n\n",
            "Subject: Help with {{product}}\nFrom: {{email}}\n\n",
            "New ticket from {{customer}} (priority: high)\n\n",
        ),
        banks=(("support", 1.0),),
        k=(1, 3),
        joiner="\n\n",
        footers=("", "\n\nThanks,\n{{person}}", "\n\n- {{person}}, {{customer}}"),
    ),
    Genre(
        "launch-review",
        headers=(
            "Launch review: {{codename}}\n\n",
            "{{codename}} go/no-go notes\n\n",
            "Launch readiness - {{codename}} (target {{launch_date}})\n\n",
        ),
        banks=(("launch", 1.0),),
        k=(3, 6),
        prefixes=("- ", "* "),
    ),
    Genre(
        "finance-update",
        headers=("Finance update (internal)\n\n", "Board pre-read\n\n", ""),
        banks=(("finance", 1.0),),
        k=(2, 4),
        joiner=" ",
    ),
    Genre(
        "sales-notes",
        headers=("Pipeline notes\n\n", "Deal desk - weekly\n\n", ""),
        banks=(("sales", 1.0),),
        k=(2, 5),
        prefixes=("* ", ""),
    ),
    Genre(
        "code",
        headers=("",),
        banks=(("code", 0.6), ("code_neutral", 0.4)),
        k=(1, 2),
    ),
    Genre(
        "press-release",
        headers=("FOR IMMEDIATE RELEASE\n\n", "{{company}} announces {{product}}\n\n"),
        banks=(("press", 1.0),),
        k=(3, 5),
        joiner=" ",
    ),
    Genre(
        "release-notes",
        headers=(
            "Release notes - {{product}} {{version}}\n\n",
            "What's new in {{version}}\n\n",
        ),
        banks=(("release", 1.0),),
        k=(2, 5),
        prefixes=("- ",),
    ),
    Genre(
        "public-docs",
        headers=("", "## Authentication\n\n", "## Limits\n\n"),
        banks=(("docs", 1.0),),
        k=(1, 3),
        joiner="\n\n",
    ),
)


def _pick_snippets(
    rng: random.Random, genre: Genre, split: Split, k: int
) -> list[tuple[str, Snippet]]:
    pools = {b: bank_for_split(b, split) for b, _ in genre.banks}
    names = [b for b, _ in genre.banks]
    weights = [w for _, w in genre.banks]
    chosen: list[tuple[str, Snippet]] = []
    used: set[str] = set()
    for _ in range(k * 3):
        if len(chosen) == k:
            break
        bank = rng.choices(names, weights)[0]
        options = [p for p in pools[bank] if p[0] not in used]
        if not options:
            continue
        sid, snip = rng.choice(options)
        used.add(sid)
        chosen.append((sid, snip))
    return chosen


def generate_doc(genre: Genre, index: int, seed: int) -> Record:
    doc_id = f"mh-offline-{genre.name}-{index:05d}"
    split = assign_split(doc_id)
    rng = random.Random(f"{seed}:{doc_id}")
    b = DocBuilder(rng, split)

    b.add(rng.choice(genre.headers))
    k = rng.randint(*genre.k)
    snippets = _pick_snippets(rng, genre, split, k)
    prefix = rng.choice(genre.prefixes)
    negative: set[str] = set()
    for i, (_sid, snip) in enumerate(snippets):
        if i:
            b.add(genre.joiner)
        b.add(prefix.replace("%d", str(rng.randint(1, 3))).replace("%i", str(i + 1)))
        b.add(snip.text)
        negative.update(snip.negative_for)
    b.add(rng.choice(genre.footers))

    text = b.text
    # Trim trailing whitespace without breaking offsets (spans never end in whitespace).
    text = text.rstrip()
    present = {s.label for s in b.spans}
    return Record(
        id=doc_id,
        text=text,
        spans=b.spans,
        source=SOURCE,
        group=doc_id,
        genre=genre.name,
        negative_for=sorted(negative - present),
        meta={
            "backend": "offline",
            "seed": seed,
            "snippets": [sid for sid, _ in snippets],
        },
    )


def generate(docs_per_genre: int, seed: int = 0) -> Iterator[Record]:
    for genre in GENRES:
        for i in range(docs_per_genre):
            yield generate_doc(genre, i, seed)
