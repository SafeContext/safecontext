"""The classifier interface every model is scored through.

A classifier sees one document at a time (`Doc`: id + text, never the gold spans) and returns
`Prediction`s: character spans with a data type id. Offsets follow the dataset's convention:
Python string indices (Unicode code points), 0-based, `end` exclusive.

To add a model, write a `Classifier` subclass and register a factory in `adapters/__init__.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..dataset import SPAN_LABELS
from ..dataset.schema import Record


@dataclass(frozen=True)
class Doc:
    """What a classifier is given: the record id and its text. Nothing else."""

    id: str
    text: str


@dataclass(frozen=True)
class Prediction:
    start: int
    end: int
    #: A data type id from `SPAN_LABELS` (e.g. "secrets"), never a display name.
    label: str
    #: Model confidence 0..1. Rules and exact matches use 1.0. Not used for scoring yet.
    score: float = 1.0


class Classifier:
    """Base class for anything the harness can score.

    Subclasses set `name` and `labels`, and implement `predict`. The harness calls `setup()`
    once (untimed, e.g. to load weights), then `predict()` once per document, timing each call.
    """

    #: Short id used in report titles and result file names.
    name: str = "classifier"
    #: The data type ids this classifier can produce. Labels outside this set are marked as
    #: "not predicted by this model" in the report rather than scored as a model failure.
    labels: tuple[str, ...] = SPAN_LABELS
    #: True when latency comes from somewhere else (e.g. a predictions file recorded by the
    #: TypeScript agent) rather than from timing `predict()` here. See `latency_ms`.
    reports_own_latency: bool = False

    def setup(self) -> None:
        """Load models etc. Called once before the timed loop."""

    def predict(self, doc: Doc) -> list[Prediction]:
        raise NotImplementedError

    def latency_ms(self, doc: Doc) -> float | None:
        """Only used when `reports_own_latency` is True: the recorded latency for this doc."""
        return None


@dataclass
class AdapterContext:
    """What an adapter factory gets: the records being scored and adapter options from the CLI."""

    records: list[Record]
    options: dict[str, Any] = field(default_factory=dict)
