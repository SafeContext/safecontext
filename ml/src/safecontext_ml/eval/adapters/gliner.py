"""GLiNER adapter: to be written in issue #13 (fine-tune and score GLiNER variants).

Sketch of what it needs to do, based on the #5 spike (`ml/spikes/gliner/`):

    class GlinerClassifier(Classifier):
        name = "gliner-small-v2.1"           # include the variant / checkpoint in the name

        def __init__(self, model_path: str, threshold: float = 0.5) -> None: ...

        def setup(self) -> None:
            from gliner import GLiNER        # import lazily: tests must not need torch
            self.model = GLiNER.from_pretrained(self.model_path)   # or load_onnx_model=True

        def predict(self, doc: Doc) -> list[Prediction]:
            # GLiNER takes natural-language label prompts. Map our data type ids to prompts
            # (e.g. from `dataset.labels.DATA_TYPES` names/descriptions) and back.
            ents = self.model.predict_entities(doc.text, PROMPTS, flat_ner=True,
                                               threshold=self.threshold)
            return [Prediction(e["start"], e["end"], PROMPT_TO_ID[e["label"]], e["score"])
                    for e in ents]

Long documents need chunking (the model's context is ~384 tokens); map chunk offsets back to the
full text. To score the TypeScript `onnxruntime-node` port instead, write its output in the
predictions-file format and use `predictions:FILE --pred-offsets utf16`.
"""

from __future__ import annotations

from ..classifier import AdapterContext, Classifier


def factory(arg: str | None, ctx: AdapterContext) -> Classifier:
    raise NotImplementedError(
        "The GLiNER adapter is issue #13. See safecontext_ml/eval/adapters/gliner.py for the "
        "sketch, or score GLiNER output now with predictions:FILE."
    )
