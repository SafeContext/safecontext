"""GLiNER wrapper for tier 1: prompts in, data type spans out, long documents chunked.

Heavy imports (torch, gliner) happen in `GlinerTagger.load`, so importing this module is cheap.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import chunking
from .prompts import prompt_set

#: Encoder limit for DeBERTa-v3 (and GLiNER's tokenizer truncation length).
MAX_TOKENS = 512
#: Head-room for special tokens and tokenizer quirks.
SAFETY = 8


@dataclass
class TaggerConfig:
    model: str = "urchade/gliner_small-v2.1"
    threshold: float = 0.5
    prompts: str = "fine"
    #: "cpu", "mps" or "onnx" (onnxruntime on CPU, `model` is an export directory).
    device: str = "cpu"
    batch_size: int = 8
    #: Words shared by neighbouring windows. The agent (#15) uses the model's max_width (12).
    overlap: int = 12
    #: Extra prompt -> id pairs, e.g. from an export's labels.json.
    prompt_map: dict[str, str] | None = None
    onnx_file: str = "model.onnx"


class GlinerTagger:
    def __init__(self, config: TaggerConfig) -> None:
        self.config = config
        self.prompt_map = config.prompt_map or prompt_set(config.prompts)
        self.prompts = list(self.prompt_map)
        self.model: Any = None
        self.tokenizer: Any = None
        self.budget = 0
        self.max_words = 384

    def load(self) -> GlinerTagger:
        from gliner import GLiNER  # lazy: torch is heavy

        c = self.config
        if c.device == "onnx":
            self.model = GLiNER.from_pretrained(
                str(Path(c.model)), load_onnx_model=True, onnx_model_file=c.onnx_file
            )
        else:
            self.model = GLiNER.from_pretrained(c.model, map_location=c.device)
            self.model.to(c.device)
            self.model.eval()
        self.tokenizer = self.model.data_processor.transformer_tokenizer
        self.max_words = int(getattr(self.model.config, "max_len", 384) or 384)
        prompt_tokens = 0
        ent = self.model.config.ent_token
        sep = self.model.config.sep_token
        for piece in [t for p in self.prompts for t in (ent, p)] + [sep]:
            prompt_tokens += len(
                self.tokenizer(piece, add_special_tokens=False)["input_ids"]
            )
        self.budget = MAX_TOKENS - 2 - prompt_tokens - SAFETY
        if self.budget < 64:
            raise ValueError(f"label prompt is too long ({prompt_tokens} tokens)")
        return self

    def _token_counts(self, text: str, offsets: list[tuple[int, int]]) -> list[int]:
        pieces = [text[s:e] for s, e in offsets]
        ids = self.tokenizer(pieces, add_special_tokens=False)["input_ids"]
        return [max(1, len(x)) for x in ids]

    def windows(self, text: str) -> list[chunking.Window]:
        offsets = chunking.words(text)
        counts = self._token_counts(text, offsets) if offsets else []
        return chunking.windows(
            offsets, counts, self.budget, self.max_words, self.config.overlap
        )

    def predict(self, text: str) -> list[chunking.Span]:
        return self.predict_many([text])[0]

    def predict_many(self, texts: list[str]) -> list[list[chunking.Span]]:
        """Tag several documents; all their windows go through GLiNER in batches."""
        pieces: list[str] = []
        owners: list[tuple[int, int]] = []  # (doc index, char offset of the window)
        for d, text in enumerate(texts):
            for w in self.windows(text):
                pieces.append(text[w.start : w.end])
                owners.append((d, w.start))
        if not pieces:
            return [[] for _ in texts]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ents = self.model.inference(
                pieces,
                self.prompts,
                flat_ner=True,
                threshold=self.config.threshold,
                batch_size=self.config.batch_size,
            )
        raw: list[list[chunking.Span]] = [[] for _ in texts]
        for (d, base), found in zip(owners, ents, strict=True):
            for e in found:
                raw[d].append(
                    chunking.Span(
                        base + e["start"],
                        base + e["end"],
                        self.prompt_map[e["label"]],
                        float(e["score"]),
                    )
                )
        return [chunking.merge(spans) for spans in raw]
