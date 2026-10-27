"""Score predictions made elsewhere (the TypeScript tier 0, a GLiNER run, any outside system).

File format: JSONL, one line per record:

    {"id": "mh-offline-code-00012", "spans": [{"start": 0, "end": 5, "label": "secrets"}],
     "latency_ms": 2.4}

- `id` matches the dataset record id. Every scored record must have a line (or pass
  `--allow-missing`, which scores missing records as "predicted nothing").
- Each span has `start`, `end` and either `label` or `dataTypeId` (the field name
  `@safecontext/detectors` uses). Labels that are not span labels (green types, custom admin
  types) are dropped and counted.
- Offsets are Python code points by default. Output from JavaScript counts UTF-16 code units:
  pass `--pred-offsets utf16` and they are converted using the record text.
- `latency_ms` is optional. If any line has it, the report uses those values; otherwise the
  latency row says "not measured".

`python -m safecontext_ml.eval --write-inputs FILE` writes the `{id, text}` lines to feed the
other system, and `--save-predictions FILE` writes this format from any adapter.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from ...dataset import SPAN_LABELS
from ..classifier import AdapterContext, Classifier, Doc, Prediction


def utf16_to_codepoint(text: str, offset: int) -> int:
    """Convert a UTF-16 code unit offset into a Python string index."""
    if text.isascii() or all(ord(c) < 0x10000 for c in text):
        return offset
    units = 0
    for i, ch in enumerate(text):
        if units >= offset:
            return i
        units += 2 if ord(ch) >= 0x10000 else 1
    return len(text)


def read_predictions(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                out[str(obj["id"])] = obj
            except (KeyError, ValueError, TypeError) as e:
                raise ValueError(f"{path}:{lineno}: {e}") from e
    return out


class PredictionsFile(Classifier):
    def __init__(
        self,
        path: Path,
        offsets: str = "codepoint",
        allow_missing: bool = False,
    ) -> None:
        if offsets not in ("codepoint", "utf16"):
            raise ValueError(f"offsets must be 'codepoint' or 'utf16', not {offsets!r}")
        self.path = path
        self.name = f"predictions-{path.stem}"
        self.offsets = offsets
        self.allow_missing = allow_missing
        self.rows = read_predictions(path)
        self.reports_own_latency = any("latency_ms" in r for r in self.rows.values())
        self.unknown_labels: dict[str, int] = {}
        self.missing = 0
        # A file can contain anything, so treat every span label as "attempted".
        self.labels = SPAN_LABELS

    def predict(self, doc: Doc) -> list[Prediction]:
        row = self.rows.get(doc.id)
        if row is None:
            if not self.allow_missing:
                raise KeyError(
                    f"{self.path}: no predictions for record {doc.id!r} "
                    "(pass --allow-missing to score it as 'predicted nothing')"
                )
            self.missing += 1
            return []
        preds = []
        for s in row.get("spans", []):
            label = s.get("label", s.get("dataTypeId"))
            if label not in SPAN_LABELS:
                self.unknown_labels[str(label)] = (
                    self.unknown_labels.get(str(label), 0) + 1
                )
                continue
            start, end = int(s["start"]), int(s["end"])
            if self.offsets == "utf16":
                start = utf16_to_codepoint(doc.text, start)
                end = utf16_to_codepoint(doc.text, end)
            preds.append(
                Prediction(
                    start, end, label, float(s.get("score", s.get("confidence", 1.0)))
                )
            )
        return preds

    def latency_ms(self, doc: Doc) -> float | None:
        row = self.rows.get(doc.id)
        if row is None or row.get("latency_ms") is None:
            return None
        return float(row["latency_ms"])

    def warnings(self) -> list[str]:
        out = []
        if self.unknown_labels:
            out.append(
                f"dropped spans with labels that are not span labels: {self.unknown_labels}"
            )
        if self.missing:
            out.append(
                f"{self.missing} records had no line in {self.path.name} (scored as empty)"
            )
        return out


def factory(arg: str | None, ctx: AdapterContext) -> Classifier:
    if not arg:
        raise ValueError(
            "usage: predictions:PATH (a JSONL file, see predictions_file.py)"
        )
    clf = PredictionsFile(
        Path(arg),
        offsets=ctx.options.get("pred_offsets", "codepoint"),
        allow_missing=bool(ctx.options.get("allow_missing", False)),
    )
    if clf.reports_own_latency is False:
        print(
            f"note: {arg} has no latency_ms; latency will not be reported",
            file=sys.stderr,
        )
    return clf
