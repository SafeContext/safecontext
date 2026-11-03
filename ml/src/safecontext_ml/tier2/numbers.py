"""Numbers in sensitive spans and in their vague rewrites: parse, compare, bucket.

Used by the generalize evaluation (no Claude needed):
- `parse_value("$4.2M")` -> Value(4_200_000, "money")
- `parse_numbers(text)`: every number written in a rewrite, with its value
- `claimed_range(rewrite, value)`: the interval a rewrite like "high teens", "about $4M",
  "under 1%", "low six figures" or "a few million" claims, or None when it can't tell
- `rule_rewrite(span)`: a deterministic baseline (one significant digit: "roughly $4M")

These are heuristics for English business text, not a general number parser.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

_MAG = {
    "k": 1e3,
    "thousand": 1e3,
    "thousands": 1e3,
    "hundreds": 1e2,
    "m": 1e6,
    "mm": 1e6,
    "mn": 1e6,
    "million": 1e6,
    "millions": 1e6,
    "b": 1e9,
    "bn": 1e9,
    "billion": 1e9,
    "billions": 1e9,
}
_CURRENCY = "$€£¥"

# A number with optional currency, sign, thousands separators, decimals, magnitude and unit.
_NUM = re.compile(
    r"(?P<cur>[$€£¥])?\s?(?P<sign>[-−+])?(?P<cur2>[$€£¥])?"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s?(?P<mag>thousand|millions?|billions?|bn|mn|mm|[kKmMbB])\b)?"
    r"\s?(?P<unit>%|percent\b|pts?\b|ms\b|s\b|seconds?\b|x\b)?",
)


@dataclass(frozen=True)
class Value:
    value: float
    #: "percent", "money", "duration_ms", "count"
    kind: str
    #: The digits as written, without separators ("4.2", "34679000").
    digits: str
    #: Significant digits as written ("4.2" -> 2, "13,000" -> 2, "70" -> 1).
    sig: int


def _sig(num: str) -> int:
    d = num.replace(",", "")
    if "." in d:
        return len(d.replace(".", "").lstrip("0")) or 1
    return len(d.lstrip("0").rstrip("0")) or 1


def _to_value(m: re.Match[str]) -> Value:
    num = m["num"]
    v = float(num.replace(",", ""))
    mag = (m["mag"] or "").lower()
    v *= _MAG.get(mag, 1.0)
    unit = (m["unit"] or "").lower()
    if m["sign"] in ("-", "−"):
        v = -v
    if unit in ("%", "percent", "pt", "pts"):
        kind = "percent"
    elif m["cur"] or m["cur2"]:
        kind = "money"
    elif unit == "ms":
        kind = "duration_ms"
    elif unit in ("s", "second", "seconds"):
        kind, v = "duration_ms", v * 1000
    else:
        kind = "count"
    return Value(v, kind, num.replace(",", ""), _sig(num))


def parse_value(span_text: str) -> Value | None:
    """The value of a sensitive number span ("$4.2M", "18%", "-3.2%", "340 ms", "12,946")."""
    m = _NUM.search(span_text)
    return _to_value(m) if m else None


def parse_numbers(text: str) -> list[Value]:
    """Every number written in `text`."""
    return [_to_value(m) for m in _NUM.finditer(text)]


# --- the interval a vague phrase claims ---

_DECADES = {
    "teens": 10,
    "twenties": 20,
    "thirties": 30,
    "forties": 40,
    "fifties": 50,
    "sixties": 60,
    "seventies": 70,
    "eighties": 80,
    "nineties": 90,
}
_FIGURES = {
    "four": 3,
    "five": 4,
    "six": 5,
    "seven": 6,
    "eight": 7,
    "nine": 8,
    "ten": 9,
}
_FRACTIONS = {
    "half": 50.0,
    "a third": 100 / 3,
    "one third": 100 / 3,
    "two thirds": 200 / 3,
    "two-thirds": 200 / 3,
    "a quarter": 25.0,
    "three quarters": 75.0,
    "three-quarters": 75.0,
    "a fifth": 20.0,
    "a tenth": 10.0,
}
_LOW_MID_HIGH = {"low": (0.0, 0.4), "mid": (0.3, 0.7), "high": (0.6, 1.0)}

_ABOVE = r"(?:over|more than|above|exceeding|at least|upwards of|north of|beyond|greater than|in excess of)"
_BELOW = r"(?:under|less than|below|up to|at most|fewer than|no more than|sub-?)"
#: How far "about N" may be from N, relative (one significant digit rounds by up to ~±35%).
ABOUT_TOLERANCE = 0.4


def _bounds(word: str, base: float, width: float) -> tuple[float, float]:
    lo_f, hi_f = _LOW_MID_HIGH[word]
    return base + lo_f * width, base + hi_f * width


def claimed_range(rewrite: str, original: Value) -> tuple[float, float] | None:
    """The interval [lo, hi] the rewrite claims for the value, in the original's units, or
    None if no rule applies. Signs are ignored ("down 3%" and "-3%" both compare 3)."""
    s = rewrite.lower().replace("‑", "-").replace("–", "-")
    target_kind = original.kind

    # "low/mid/high teens", "high twenties", "teens"
    m = re.search(
        r"\b(?:(low|mid|high)[- ])?(teens|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b",
        s,
    )
    if m and target_kind == "percent":
        base = _DECADES[m[2]]
        return _bounds(m[1], base, 10) if m[1] else (base, base + 10)
    # "single digits", "low single digits", "double digits"
    m = re.search(r"\b(?:(low|mid|high)[- ])?(single|double|triple)[- ]digits?\b", s)
    if m:
        lo, hi = {"single": (0, 10), "double": (10, 100), "triple": (100, 1000)}[m[2]]
        if m[1]:
            lo, hi = _bounds(m[1], lo, hi - lo)
        return lo, hi
    # "six figures", "low seven-figure"
    m = re.search(
        r"\b(?:(low|mid|high)[- ])?(four|five|six|seven|eight|nine|ten)[- ]figures?\b",
        s,
    )
    if m:
        lo = 10.0 ** _FIGURES[m[2]]
        hi = lo * 10
        if m[1]:
            lo, hi = {
                "low": (lo, 4 * lo),
                "mid": (3 * lo, 7 * lo),
                "high": (6 * lo, hi),
            }[m[1]]
        return lo, hi
    # "tens of millions", "hundreds of thousands", "a few million", "several million", "millions"
    m = re.search(r"\b(tens|hundreds) of (thousands|millions|billions)\b", s)
    if m:
        unit = _MAG[m[2]]
        lo = unit * (10 if m[1] == "tens" else 100)
        return lo, lo * 10
    m = re.search(
        r"\b(a few|a couple of|several|a handful of)\s+(hundred|thousand|million|billion)s?\b",
        s,
    )
    if m:
        unit = 100.0 if m[2] == "hundred" else _MAG[m[2]]
        lo, hi = {
            "a few": (2, 10),
            "a couple of": (1.5, 3),
            "several": (3, 10),
            "a handful of": (2, 10),
        }[m[1]]
        return lo * unit, hi * unit
    m = re.search(r"\b(hundreds|thousands|millions|billions)\b", s)
    if m and not re.search(r"\d", s):
        unit = 100.0 if m[1] == "hundreds" else _MAG[m[1]]
        return unit, unit * 1000
    # fractions of a whole, for percentages: "about a third", "over half"
    if target_kind == "percent":
        for phrase, val in _FRACTIONS.items():
            if re.search(rf"\b{phrase}\b", s):
                return _qualified(s, val)
        if re.search(r"\bmajority\b", s):
            return 50.0, 100.0
    nums = parse_numbers(s)
    # "between 10 and 20%", "10-20%", "$1-2M"
    if len(nums) == 2 and re.search(r"\d\S*\s*(?:-|to|and)\s*[$€£¥]?\d", s):
        a, b = nums
        mult_b = abs(b.value) / float(b.digits) if float(b.digits) else 1.0
        av = abs(a.value)
        if (
            av == float(a.digits) and mult_b != 1.0
        ):  # "$1-2M": the first takes the second's magnitude
            av *= mult_b
        bv = abs(b.value)
        return min(av, bv), max(av, bv)
    if len(nums) == 1:
        return _qualified(s, abs(nums[0].value))
    return None


def _qualified(s: str, val: float) -> tuple[float, float]:
    """The interval for one number with its qualifier ("over 20%", "about $4M", "nearly 1,000")."""
    t = ABOUT_TOLERANCE
    if re.search(r"\b(?:just over|a little over|slightly over|slightly above)\b", s):
        return val, val * (1 + t / 2)
    if re.search(r"\b(?:nearly|almost|just under|close to|approaching|shy of)\b", s):
        return val * (1 - t / 2), val
    if re.search(rf"\b{_ABOVE}\b", s) or re.search(r"(?:^|\s)>|\d\+", s):
        return val, math.inf
    if re.search(rf"\b{_BELOW}", s) or re.search(r"(?:^|\s)<", s):
        return -math.inf, val
    # "about", "roughly", or a bare number: a rounded value
    return val * (1 - t), val * (1 + t)


def is_true(rewrite: str, original: Value) -> bool | None:
    """True/False if the rewrite's claim can be checked against the value, else None."""
    r = claimed_range(rewrite, original)
    if r is None:
        return None
    v = abs(original.value)
    lo, hi = r
    eps = 1e-9 * max(1.0, v)
    return lo - eps <= v <= hi + eps


# --- leak checks ---


def leaks_value(rewrite: str, original: Value, span_text: str) -> bool:
    """The rewrite repeats the value: the span text, the number's digits (2+ significant digits),
    or the same value written another way at the original's precision ("4.2 million" for
    "$4.2M", "about 70%" for "70%"). A rounder number ("about 13,000" for 12,946) is not a leak
    but may be `too_precise`."""
    low = rewrite.lower()
    if span_text.strip().lower() in low:
        return True
    for n in parse_numbers(rewrite):
        if n.digits == original.digits and original.sig >= 2:
            return True
        same = original.value and abs(
            abs(n.value) - abs(original.value)
        ) <= 0.005 * abs(original.value)
        if same and n.sig >= original.sig:
            return True
    return False


def too_precise(rewrite: str, original: Value) -> bool:
    """The rewrite gives a number with 2+ significant digits within 5% of the value
    (e.g. "about 13,000" for 12,946). Vague enough = one significant digit, or words."""
    for n in parse_numbers(rewrite):
        if (
            n.sig >= 2
            and original.value
            and abs(abs(n.value) - abs(original.value)) <= 0.05 * abs(original.value)
        ):
            return True
    return False


# --- the deterministic baseline ---


_DECADE_WORDS = {v: k for k, v in _DECADES.items()}


def _fmt_money(v: float, cur: str) -> str:
    for mag, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if v >= mag:
            return f"{cur}{v / mag:g}{suffix}"
    return f"{cur}{v:g}"


def _bound(v: float) -> tuple[str, float]:
    """A one-significant-digit bound that is true for v: ("over", 1e6) for 1.47M; for a value
    that already has one significant digit (2M), ("under", 3M), so the value isn't repeated."""
    m = 10 ** math.floor(math.log10(v))
    lead = v / m
    if abs(lead - round(lead)) < 1e-9:
        return "under", (round(lead) + 1) * m
    return "over", math.floor(lead) * m


def rule_rewrite(span_text: str) -> str | None:
    """Deterministic generalize, true by construction and never repeating the value:
    - percentages: "under 1%", "single digits", "low/mid/high <decade>" (18% -> "high teens"),
      "over 100%"
    - money, counts, durations: a one-significant-digit bound ("$4.2M" -> "over $4M",
      "12,946" -> "over 10,000", "$2M" -> "under $3M")
    None unless the whole span is one number with its currency, magnitude and unit (the
    labelling rule for number spans), so names, dates ("March 3, 2026") and mixed text are left
    to the caller's fallback. The agent's fallback when tier 2 can't answer in time (see
    `prompts/tier2/tier2.json`)."""
    m = _NUM.fullmatch(span_text.strip())
    if m is None:
        return None
    val = _to_value(m)
    v = abs(val.value)
    if val.kind == "percent":
        sign = "down " if val.value < 0 else ""
        if v < 1:
            return f"{sign}under 1%"
        if v < 10:
            return f"{sign}single digits"
        if v >= 100:
            return f"{sign}over 100%"
        base = int(v // 10) * 10
        d = v - base
        word = "low" if d < 3.5 else "mid" if d < 6.5 else "high"
        return f"{sign}{word} {_DECADE_WORDS[base]}"
    if v == 0:
        return "zero"
    word, b = _bound(v)
    if val.kind == "money":
        cur = next((c for c in span_text if c in _CURRENCY), "$")
        return f"{word} {_fmt_money(b, cur)}"
    if val.kind == "duration_ms":
        return f"{word} {b / 1000:g} s" if b >= 1000 else f"{word} {b:g} ms"
    return f"{word} {b:,.0f}"
