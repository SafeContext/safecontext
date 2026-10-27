"""Inline span markup: `<customer-names>Bluefin Logistics</customer-names>`.

The LLM backend asks the model to wrap sensitive spans in tags named after data type ids; `parse`
turns that into plain text plus spans. Only known data type ids count as tags, so ordinary code
(`<div>`, `List<String>`) passes through untouched. Tags must not nest.
"""

from __future__ import annotations

import re

from .labels import SPAN_LABELS
from .schema import Record, Span

_NAMES = "|".join(re.escape(label) for label in sorted(SPAN_LABELS, key=len, reverse=True))
TAG_RE = re.compile(rf"<({_NAMES})>(.*?)</\1>", re.DOTALL)
STRAY_RE = re.compile(rf"</?({_NAMES})>")


class MarkupError(ValueError):
    pass


def parse(marked: str) -> tuple[str, list[Span]]:
    out: list[str] = []
    spans: list[Span] = []
    length = 0
    pos = 0
    for m in TAG_RE.finditer(marked):
        before = marked[pos : m.start()]
        out.append(before)
        length += len(before)
        label, inner = m.group(1), m.group(2)
        if STRAY_RE.search(inner):
            raise MarkupError(f"nested tag inside <{label}>: {inner[:60]!r}")
        # Keep surrounding whitespace in the text but outside the span.
        lead = len(inner) - len(inner.lstrip())
        value = inner.strip()
        if not value:
            raise MarkupError(f"empty <{label}> tag")
        start = length + lead
        spans.append(Span(start, start + len(value), label, value))
        out.append(inner)
        length += len(inner)
        pos = m.end()
    rest = marked[pos:]
    if STRAY_RE.search(rest) or any(STRAY_RE.search(p) for p in out):
        raise MarkupError("unbalanced tag")
    out.append(rest)
    return "".join(out), spans


def to_markup(record: Record) -> str:
    """Inverse of `parse`, for debugging and prompt examples."""
    parts: list[str] = []
    pos = 0
    for s in record.spans:
        parts.append(record.text[pos : s.start])
        parts.append(f"<{s.label}>{s.text}</{s.label}>")
        pos = s.end
    parts.append(record.text[pos:])
    return "".join(parts)
