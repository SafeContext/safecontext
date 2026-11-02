"""Registry of classifiers the harness can score: `python -m safecontext_ml.eval <spec>`.

A spec is `name` or `name:arg`, e.g. `regex` or `predictions:out/tier0.jsonl`.

To add a model: write a `Classifier` subclass (see `classifier.py`) in this package and add a
factory here. Import heavy dependencies (torch, gliner, onnxruntime) inside the factory or in
`setup()`, so the tests and the other adapters never need them.
"""

from __future__ import annotations

from collections.abc import Callable

from ..classifier import AdapterContext, Classifier, Doc, Prediction

Factory = Callable[[str | None, AdapterContext], Classifier]


class NoneClassifier(Classifier):
    """Predicts nothing. Floor for recall, ceiling for the false-positive rates."""

    name = "none"

    def predict(self, doc: Doc) -> list[Prediction]:
        return []


class GoldOracle(Classifier):
    """Returns the gold spans. Every score should be perfect: a self-test of the harness."""

    name = "gold"

    def __init__(self, ctx: AdapterContext) -> None:
        self.by_id = {r.id: r for r in ctx.records}

    def predict(self, doc: Doc) -> list[Prediction]:
        return [Prediction(s.start, s.end, s.label) for s in self.by_id[doc.id].spans]


def _regex(arg: str | None, ctx: AdapterContext) -> Classifier:
    from .regex_baseline import RegexBaseline

    return RegexBaseline()


def _predictions(arg: str | None, ctx: AdapterContext) -> Classifier:
    from .predictions_file import factory

    return factory(arg, ctx)


def _gliner(arg: str | None, ctx: AdapterContext) -> Classifier:
    from .gliner import factory

    return factory(arg, ctx)


ADAPTERS: dict[str, tuple[Factory, str]] = {
    "regex": (_regex, "free local regex baseline for secrets and personal data"),
    "predictions": (
        _predictions,
        "predictions:PATH, score a JSONL file from any system",
    ),
    "none": (lambda arg, ctx: NoneClassifier(), "predicts nothing (floor)"),
    "gold": (
        lambda arg, ctx: GoldOracle(ctx),
        "returns the gold spans (harness self-test)",
    ),
    "gliner": (
        _gliner,
        "gliner[:MODEL[,threshold=,prompts=,device=]], GLiNER tier 1 tagger",
    ),
}


def load_classifier(spec: str, ctx: AdapterContext) -> Classifier:
    name, _, arg = spec.partition(":")
    if name not in ADAPTERS:
        known = ", ".join(sorted(ADAPTERS))
        raise ValueError(f"unknown model {name!r}; known: {known}")
    return ADAPTERS[name][0](arg or None, ctx)
