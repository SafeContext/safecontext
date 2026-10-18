"""Reference GLiNER spans for the TS comparison (issue #5 spike).

Usage (from ml/), after export_onnx.py:
    uv run python spikes/gliner/reference_spans.py

Runs samples.json through (a) the PyTorch model and (b) the exported ONNX file under
Python onnxruntime, and writes both span lists to reference_spans.json next to samples.json.
Also records the subword-token count of each text (model tokenizer, no label prompt).
"""

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


def main() -> None:
    samples = json.loads((HERE / "samples.json").read_text())
    texts, labels = samples["texts"], samples["labels"]

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
        "threshold": THRESHOLD,
        "flat_ner": True,
        "labels": labels,
        "token_counts": token_counts,
        "torch": spans(torch_model, texts, labels),
        "onnx_python": spans(ort_model, texts, labels),
    }
    (HERE / "reference_spans.json").write_text(json.dumps(result, indent=1) + "\n")
    print("token counts:", token_counts)
    print(
        "torch spans:",
        sum(map(len, result["torch"])),
        "onnx spans:",
        sum(map(len, result["onnx_python"])),
    )


if __name__ == "__main__":
    main()
