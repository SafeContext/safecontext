"""The dataset record format (schema version 1). Documented in `ml/README.md`.

One JSON object per line (JSONL, UTF-8). Offsets are Python string indices: Unicode code points,
0-based, `end` exclusive, so `text[start:end] == span.text`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .labels import SPAN_LABELS

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    label: str
    text: str

    def to_json(self) -> dict[str, Any]:
        return {"start": self.start, "end": self.end, "label": self.label, "text": self.text}

    @classmethod
    def from_json(cls, obj: dict[str, Any]) -> Span:
        return cls(int(obj["start"]), int(obj["end"]), str(obj["label"]), str(obj["text"]))


@dataclass
class Record:
    id: str
    text: str
    spans: list[Span]
    source: str
    group: str
    genre: str
    #: Labels this record was built to *look like* without containing (hard negatives).
    negative_for: list[str] = field(default_factory=list)
    #: Regions that must not be scored: sensitive in the source dataset but with no matching
    #: data type here. A prediction overlapping one is neither a true nor a false positive.
    ignore: list[Span] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def hard_negative(self) -> bool:
        return bool(self.negative_for)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "spans": [s.to_json() for s in self.spans],
            "source": self.source,
            "group": self.group,
            "genre": self.genre,
            "negative_for": list(self.negative_for),
            "ignore": [s.to_json() for s in self.ignore],
            "meta": self.meta,
        }

    @classmethod
    def from_json(cls, obj: dict[str, Any]) -> Record:
        return cls(
            id=str(obj["id"]),
            text=str(obj["text"]),
            spans=[Span.from_json(s) for s in obj.get("spans", [])],
            source=str(obj["source"]),
            group=str(obj["group"]),
            genre=str(obj["genre"]),
            negative_for=list(obj.get("negative_for", [])),
            ignore=[Span.from_json(s) for s in obj.get("ignore", [])],
            meta=dict(obj.get("meta", {})),
        )


def _check_bounds(text: str, span: Span, where: str) -> list[str]:
    if not (0 <= span.start < span.end <= len(text)):
        return [f"{where}: offsets {span.start}..{span.end} outside text of length {len(text)}"]
    if text[span.start : span.end] != span.text:
        got = text[span.start : span.end]
        return [f"{where}: text[{span.start}:{span.end}] is {got!r}, span says {span.text!r}"]
    return []


def validate(record: Record) -> list[str]:
    """Return a list of problems (empty if the record is valid)."""
    errors: list[str] = []
    if not record.id:
        errors.append("empty id")
    if not record.text.strip():
        errors.append("empty text")
    for name in ("source", "group", "genre"):
        if not getattr(record, name):
            errors.append(f"empty {name}")

    prev_end = -1
    for i, span in enumerate(record.spans):
        where = f"spans[{i}]"
        if span.label not in SPAN_LABELS:
            errors.append(f"{where}: unknown label {span.label!r}")
        errors.extend(_check_bounds(record.text, span, where))
        if span.text != span.text.strip():
            errors.append(f"{where}: leading or trailing whitespace in {span.text!r}")
        if span.start < prev_end:
            errors.append(f"{where}: overlaps or is out of order with the previous span")
        prev_end = max(prev_end, span.end)

    for i, span in enumerate(record.ignore):
        where = f"ignore[{i}]"
        errors.extend(_check_bounds(record.text, span, where))
        for s in record.spans:
            if span.start < s.end and s.start < span.end:
                errors.append(f"{where}: overlaps a labelled span")
                break

    for label in record.negative_for:
        if label not in SPAN_LABELS:
            errors.append(f"negative_for: unknown label {label!r}")
        elif any(s.label == label for s in record.spans):
            errors.append(f"negative_for: {label!r} also appears as a span")
    return errors


def read_jsonl(path: Path) -> Iterator[Record]:
    with path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if line.strip():
                try:
                    yield Record.from_json(json.loads(line))
                except (KeyError, ValueError, TypeError) as e:
                    raise ValueError(f"{path}:{lineno}: {e}") from e


def dumps(record: Record) -> str:
    return json.dumps(record.to_json(), ensure_ascii=False, separators=(",", ":"))


def write_jsonl(path: Path, records: Iterable[Record]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for r in records:
            f.write(dumps(r) + "\n")
            n += 1
    return n
