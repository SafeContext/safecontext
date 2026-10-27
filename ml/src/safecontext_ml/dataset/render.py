"""Fill `{{kind}}` / `{{kind#n}}` slots and record the spans they produce.

Inside one document the same `{{kind#n}}` always gets the same value, so a customer named in a
ticket header is the same customer in its body. `{{kind}}` is shorthand for `{{kind#1}}`.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from .schema import Span
from .split import Split
from .values import SLOT_KINDS

SLOT_RE = re.compile(r"\{\{([a-z_0-9]+?)(?:#(\d+))?\}\}")


def slot_kinds(template: str) -> set[str]:
    return {m.group(1) for m in SLOT_RE.finditer(template)}


@dataclass
class DocBuilder:
    rng: random.Random
    split: Split
    parts: list[str] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)
    _length: int = 0
    _values: dict[tuple[str, str], str] = field(default_factory=dict)

    def value(self, kind: str, n: str = "1") -> str:
        key = (kind, n)
        if key not in self._values:
            spec = SLOT_KINDS[kind]
            v = spec.generate(self.rng, self.split).strip()
            # Two different slots of a kind should not collide on the same value.
            used = {val for (k, _), val in self._values.items() if k == kind}
            for _ in range(5):
                if v not in used:
                    break
                v = spec.generate(self.rng, self.split).strip()
            self._values[key] = v
        return self._values[key]

    def _append(self, text: str) -> None:
        self.parts.append(text)
        self._length += len(text)

    def add(self, template: str) -> None:
        pos = 0
        for m in SLOT_RE.finditer(template):
            self._append(template[pos : m.start()])
            kind, n = m.group(1), m.group(2) or "1"
            if kind not in SLOT_KINDS:
                raise KeyError(f"unknown slot kind {kind!r} in template {template!r}")
            value = self.value(kind, n)
            label = SLOT_KINDS[kind].label
            if label is not None:
                self.spans.append(
                    Span(self._length, self._length + len(value), label, value)
                )
            self._append(value)
            pos = m.end()
        self._append(template[pos:])

    @property
    def text(self) -> str:
        return "".join(self.parts)


def render(template: str, rng: random.Random, split: Split) -> tuple[str, list[Span]]:
    b = DocBuilder(rng, split)
    b.add(template)
    return b.text, b.spans
