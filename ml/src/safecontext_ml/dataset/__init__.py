"""Dataset for the Safe Context classifier (issue #11). See ml/README.md for the format."""

from .build import load_split
from .labels import RED_LABELS, SPAN_LABELS
from .schema import SCHEMA_VERSION, Record, Span, read_jsonl, validate

__all__ = [
    "RED_LABELS",
    "SCHEMA_VERSION",
    "SPAN_LABELS",
    "Record",
    "Span",
    "load_split",
    "read_jsonl",
    "validate",
]
