"""Export a public GLiNER model to ONNX (issue #5 spike).

Usage (from ml/):
    uv run python spikes/gliner/export_onnx.py

Writes model.onnx, the tokenizer and gliner_config.json under ml/models/ (gitignored).
Never commit the output.
"""

import argparse
from pathlib import Path

from gliner import GLiNER

MODEL_ID = (
    "urchade/gliner_small-v2.1"  # Apache-2.0, span-based, DeBERTa-v3-small encoder
)
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "models" / "gliner_small-v2.1-onnx"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--quantize",
        action="store_true",
        help="also write an int8 model_quantized.onnx",
    )
    args = parser.parse_args()

    model = GLiNER.from_pretrained(args.model)
    paths = model.export_to_onnx(args.out, quantize=args.quantize)
    print(paths)


if __name__ == "__main__":
    main()
