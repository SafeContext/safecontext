"""A free, local regex baseline: generic patterns for secrets and personal contact data.

This exists to prove the harness end to end and to give later models a floor to beat. It is
deliberately simple and is **not** the TypeScript tier 0 (`packages/detectors`): score that with
the predictions-file adapter instead. It only predicts the two labels regexes can reasonably
find (`secrets`, `customer-personal-data`); the five business labels need a tagger.
"""

from __future__ import annotations

import re

from ...dataset.labels import PERSONAL, SECRET
from ..classifier import Classifier, Doc, Prediction

# (label, pattern). If a pattern has a group named "v", only that group is the span.
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(p, flags))
    for label, p, flags in (
        # --- secrets ---
        (
            SECRET,
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
            0,
        ),
        (SECRET, r"\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b", 0),
        (SECRET, r"\bgh[pousr]_[0-9A-Za-z]{36}\b|\bgithub_pat_\w{82}\b", 0),
        (SECRET, r"\bglpat-[\w-]{20}\b", 0),
        (SECRET, r"\bxox[abprse]-[0-9A-Za-z-]{10,}", 0),
        (SECRET, r"\b(?:sk|rk|pk)_(?:live|test|prod)_[0-9A-Za-z]{10,99}\b", 0),
        (SECRET, r"\bsk-(?:proj-|ant-)?[0-9A-Za-z_-]{20,}", 0),
        (SECRET, r"\bSG\.[\w-]{16,32}\.[\w-]{16,64}", 0),
        (SECRET, r"\bAIza[0-9A-Za-z_-]{35}\b", 0),
        (SECRET, r"\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}", 0),
        # URL with credentials: scheme://user:password@host...
        (
            SECRET,
            r"\b[a-z][a-z0-9+.-]*://[^\s:/@'\"]+:[^\s@'\"]+@[^\s'\"<>]+",
            re.IGNORECASE,
        ),
        # password = "value" / password: value
        (
            SECRET,
            (
                r"\b(?:password|passwd|pwd|secret|api[_-]?key|token)\b[\"']?\s*[:=]\s*[\"']?"
                r"(?P<v>[^\s\"',;]{6,})"
            ),
            re.IGNORECASE,
        ),
        # --- personal data ---
        (PERSONAL, r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b", 0),
        (PERSONAL, r"\b\d{3}-\d{2}-\d{4}\b", 0),  # US SSN shape
        (
            PERSONAL,
            (
                r"(?<![\w.])(?<!\d[ -])(?:\+?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{3,4}"
                r"(?![\w.]|[ -]\d)"
            ),
            0,
        ),
        (PERSONAL, r"\b(?:\d{1,3}\.){3}\d{1,3}\b", 0),  # IPv4
        (
            PERSONAL,
            r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b",
            0,
        ),  # IBAN
    )
)

_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_SAFE_EMAIL_DOMAINS = ("example.com", "example.org", "example.net")


def luhn_valid(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


class RegexBaseline(Classifier):
    name = "regex"
    labels = (SECRET, PERSONAL)

    def predict(self, doc: Doc) -> list[Prediction]:
        text = doc.text
        found: list[Prediction] = []
        for label, rx in _RULES:
            for m in rx.finditer(text):
                start, end = m.span("v") if "v" in rx.groupindex else m.span()
                value = m.group(0).lower()
                if (
                    label == PERSONAL
                    and "@" in value
                    and value.endswith(_SAFE_EMAIL_DOMAINS)
                ):
                    continue
                found.append(Prediction(start, end, label))
        for m in _CARD.finditer(text):
            digits = re.sub(r"\D", "", m.group(0))
            if 13 <= len(digits) <= 19 and luhn_valid(digits):
                found.append(Prediction(m.start(), m.end(), PERSONAL))
        return _drop_contained(found)


def _drop_contained(preds: list[Prediction]) -> list[Prediction]:
    """Keep the longest span where rules overlap (e.g. a token inside a connection string)."""
    preds.sort(key=lambda p: (p.start, -(p.end - p.start)))
    out: list[Prediction] = []
    for p in preds:
        if out and p.start < out[-1].end:
            continue
        out.append(p)
    return out
