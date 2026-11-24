"""Reference GLiNER spans for the TS comparison (issue #5 spike; any model since #113).

Usage (from ml/):
    uv run python spikes/gliner/reference_spans.py                    # base model, after export_onnx.py
    uv run python spikes/gliner/reference_spans.py --model-dir models/tier1-onnx --out reference_spans.tier1-onnx.json

Runs samples.json through the model and writes the spans next to samples.json. Without
--model-dir: (a) the PyTorch base model and (b) its ONNX export under Python onnxruntime, as in
the #5 spike. With --model-dir: only that ONNX export (the agent's tier 1 model). Each file
records the sha256 of the model.onnx it was made with; the agent's test
(apps/agent/src/classifier/tier1/gliner.test.ts) uses the file whose sha256 matches the model
it is given. Also records the subword-token count of each text (no label prompt).
"""

import argparse
import hashlib
import json
from pathlib import Path

from gliner import GLiNER

HERE = Path(__file__).resolve().parent
MODEL_ID = "urchade/gliner_small-v2.1"
ONNX_DIR = HERE.parents[1] / "models" / "gliner_small-v2.1-onnx"
THRESHOLD = 0.5


def spans(model: GLiNER, texts: list[str], labels: list[str]) -> list[list[dict]]:
    out = []
    for text in texts:
        found = model.predict_entities(text, labels, flat_ner=True, threshold=THRESHOLD)
        out.append(
            [
                {
                    "start": e["start"],
                    "end": e["end"],
                    "label": e["label"],
                    "score": round(float(e["score"]), 5),
                }
                for e in sorted(found, key=lambda e: (e["start"], e["end"], e["label"]))
            ]
        )
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-dir", type=Path, help="an ONNX export (e.g. models/tier1-onnx)"
    )
    parser.add_argument(
        "--out", default="reference_spans.json", help="file name, next to samples.json"
    )
    args = parser.parse_args()
    samples = json.loads((HERE / "samples.json").read_text())
    texts, labels = samples["texts"], samples["labels"]

    if args.model_dir:
        model_dir = args.model_dir.resolve()
        ort_model = GLiNER.from_pretrained(
            str(model_dir), load_onnx_model=True, load_tokenizer=True
        )
        tokenizer = ort_model.data_processor.transformer_tokenizer
        provenance = model_dir / "provenance.json"
        result = {
            "model": model_dir.name,
            "model_onnx_sha256": sha256(model_dir / "model.onnx"),
            "provenance": json.loads(provenance.read_text()).get("base_model")
            if provenance.exists()
            else None,
            "threshold": THRESHOLD,
            "flat_ner": True,
            "labels": labels,
            "token_counts": [
                len(tokenizer(t, add_special_tokens=False)["input_ids"]) for t in texts
            ],
            "onnx_python": spans(ort_model, texts, labels),
        }
        (HERE / args.out).write_text(json.dumps(result, indent=1) + "\n")
        print("onnx spans:", sum(map(len, result["onnx_python"])))
        return

    torch_model = GLiNER.from_pretrained(MODEL_ID)
    tokenizer = torch_model.data_processor.transformer_tokenizer
    token_counts = [
        len(tokenizer(t, add_special_tokens=False)["input_ids"]) for t in texts
    ]

    ort_model = GLiNER.from_pretrained(
        str(ONNX_DIR), load_onnx_model=True, load_tokenizer=True
    )

    result = {
        "model": MODEL_ID,
        "model_onnx_sha256": sha256(ONNX_DIR / "model.onnx"),
        "threshold": THRESHOLD,
        "flat_ner": True,
        "labels": labels,
        "token_counts": token_counts,
        "torch": spans(torch_model, texts, labels),
        "onnx_python": spans(ort_model, texts, labels),
    }
    (HERE / args.out).write_text(json.dumps(result, indent=1) + "\n")
    print("token counts:", token_counts)
    print(
        "torch spans:",
        sum(map(len, result["torch"])),
        "onnx spans:",
        sum(map(len, result["onnx_python"])),
    )


if __name__ == "__main__":
    main()
