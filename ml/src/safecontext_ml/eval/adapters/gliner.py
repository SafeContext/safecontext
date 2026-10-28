"""GLiNER adapter (issue #13): `python -m safecontext_ml.eval gliner[:MODEL[,key=value...]]`.

MODEL is a Hugging Face id or a local directory (a fine-tuned checkpoint, or an ONNX export
with `device=onnx`). Default: `urchade/gliner_small-v2.1`. Options:

| key | default | meaning |
| --- | --- | --- |
| `threshold` | 0.5 (or the export's `tier1.json`) | minimum span score |
| `prompts` | `fine` (or the export's `labels.json`) | prompt set from `tagger/prompts.py` |
| `device` | `cpu` | `cpu`, `mps` (Apple GPU, PyTorch) or `onnx` (onnxruntime CPU on an export directory) |
| `batch` | 8 | windows per GLiNER batch |
| `name` | derived | report name |

Examples:

    gliner:urchade/gliner_large-v2.1,device=mps
    gliner:models/tier1-finetuned,prompts=names,threshold=0.4
    gliner:models/tier1-onnx,device=onnx

Long documents are cut into windows (`tagger/chunking.py`); offsets are Python code points.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from ...tagger import GlinerTagger, TaggerConfig, prompt_set
from ..classifier import AdapterContext, Classifier, Doc, Prediction

DEFAULT_MODEL = "urchade/gliner_small-v2.1"


def parse(arg: str | None) -> tuple[TaggerConfig, str | None]:
    parts = [p for p in (arg or "").split(",") if p]
    model = DEFAULT_MODEL
    if parts and "=" not in parts[0]:
        model = parts.pop(0)
    opts: dict[str, str] = {}
    for p in parts:
        key, sep, value = p.partition("=")
        if not sep:
            raise ValueError(f"gliner option {p!r} must be key=value")
        opts[key.strip()] = value.strip()
    unknown = set(opts) - {"threshold", "prompts", "device", "batch", "name"}
    if unknown:
        raise ValueError(f"unknown gliner option(s): {', '.join(sorted(unknown))}")
    meta_file = Path(model) / "tier1.json"
    meta = json.loads(meta_file.read_text()) if meta_file.is_file() else {}
    cfg = TaggerConfig(
        model=model,
        threshold=float(opts.get("threshold", meta.get("threshold", 0.5))),
        prompts=opts.get("prompts", "fine"),
        device=opts.get("device", "cpu"),
        batch_size=int(opts.get("batch", 8)),
    )
    labels_file = Path(model) / "labels.json"
    if labels_file.is_file() and "prompts" not in opts:
        # the agent's format: {"<data type id>": "<label text>"}
        labels = json.loads(labels_file.read_text())
        cfg.prompt_map = {text: type_id for type_id, text in labels.items()}
        cfg.prompts = "export"
    else:
        prompt_set(cfg.prompts)  # fail early on a typo
    return cfg, opts.get("name")


def default_name(cfg: TaggerConfig) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(cfg.model.rstrip("/")).name)
    return f"gliner-{base}-{cfg.prompts}-t{cfg.threshold:g}" + (
        "-onnx" if cfg.device == "onnx" else ""
    )


class GlinerClassifier(Classifier):
    def __init__(self, cfg: TaggerConfig, name: str | None = None) -> None:
        self.cfg = cfg
        self.name = name or default_name(cfg)
        self.tagger = GlinerTagger(cfg)
        self.labels = tuple(dict.fromkeys(self.tagger.prompt_map.values()))

    def setup(self) -> None:
        self.tagger.load()

    def predict(self, doc: Doc) -> list[Prediction]:
        return [
            Prediction(s.start, s.end, s.label, s.score)
            for s in self.tagger.predict(doc.text)
        ]


def factory(arg: str | None, ctx: AdapterContext) -> Classifier:
    cfg, name = parse(arg)
    return GlinerClassifier(cfg, name)
