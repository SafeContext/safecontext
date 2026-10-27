"""Evaluation harness (issue #12): score any classifier the same way. See ml/README.md."""

from .adapters import ADAPTERS, load_classifier
from .classifier import AdapterContext, Classifier, Doc, Prediction
from .metrics import GroupScores, LabelCounts, Scorer, score_record

__all__ = [
    "ADAPTERS",
    "AdapterContext",
    "Classifier",
    "Doc",
    "GroupScores",
    "LabelCounts",
    "Prediction",
    "Scorer",
    "load_classifier",
    "score_record",
]
