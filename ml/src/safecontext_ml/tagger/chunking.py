"""Split long documents into windows GLiNER can read, and merge the spans back.

GLiNER reads at most `max_len` words (384) and its encoder at most 512 subword tokens,
*including* the label prompt. Longer input is silently truncated. So the tagger splits a
document into windows of whole words that fit a token budget, overlapping by `overlap` words
(at least the model's `max_width`, 12, so any span GLiNER can produce lies whole inside some
window), runs each window, shifts offsets back and keeps the best non-overlapping spans.

The TypeScript agent (#15) needs the same rule; it is deliberately simple:
1. Split words with `WORD_RE` (GLiNER's own `WhitespaceTokenSplitter`).
2. Greedily add words to a window while its subword count stays <= budget and it has at most
   `max_words` words.
3. Start the next window `overlap` words before the end of the previous one.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

#: GLiNER 0.2.x `WhitespaceTokenSplitter`. Python `\w` is Unicode-aware, like the TS
#: `[\p{L}\p{M}\p{N}_]` in apps/agent/scripts/gliner/gliner.ts.
WORD_RE = re.compile(r"\w+(?:[-_]\w+)*|\S")


@dataclass(frozen=True)
class Window:
    start: int  # character offsets in the document
    end: int
    first_word: int
    last_word: int  # inclusive


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    label: str
    score: float


def words(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in WORD_RE.finditer(text)]


def windows(
    word_offsets: Sequence[tuple[int, int]],
    token_counts: Sequence[int],
    budget: int,
    max_words: int = 384,
    overlap: int = 16,
) -> list[Window]:
    """Cut words into overlapping windows of at most `budget` subword tokens.

    A single word longer than the budget gets a window of its own (GLiNER truncates it).
    """
    n = len(word_offsets)
    if n == 0:
        return []
    out: list[Window] = []
    i = 0
    while True:
        j, used = i, 0
        while (
            j < n and j - i < max_words and (used + token_counts[j] <= budget or j == i)
        ):
            used += token_counts[j]
            j += 1
        out.append(Window(word_offsets[i][0], word_offsets[j - 1][1], i, j - 1))
        if j >= n:
            return out
        i = max(i + 1, j - overlap)


def merge(spans: list[Span]) -> list[Span]:
    """Greedy flat merge: highest score first, drop any span overlapping one already kept."""
    kept: list[Span] = []
    for s in sorted(spans, key=lambda s: (-s.score, s.start, s.end)):
        if all(s.end <= k.start or s.start >= k.end for k in kept):
            kept.append(s)
    return sorted(kept, key=lambda s: (s.start, s.end))
