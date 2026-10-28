"""Export the tier 1 tagger to ONNX for the TypeScript agent (issue #13 -> #15).

    uv run python -m safecontext_ml.export                       # chosen model -> models/tier1-onnx/
    uv run python -m safecontext_ml.export --model urchade/gliner_small-v2.1 --prompts entity2 \
        --threshold 0.15 --out models/gliner-small-onnx

`--model` is a Hugging Face id (downloaded on first use) or a local fine-tuned checkpoint from
`python -m safecontext_ml.tagger.finetune`. The output directory (gitignored, never commit it):

    model.onnx              fp32 graph, opset 19, from gliner's own export_to_onnx (as in #5)
    gliner_config.json      max_width, max_len, ent_token, sep_token... (read by the TS loader)
    tokenizer.json, tokenizer_config.json (+ special tokens files)
    labels.json             {"<data type id>": "<label text>"}: the one prompt per data type the
                            model was tuned with. The agent (#15, SC_TIER1_MODEL_DIR) reads it
                            and uses it instead of its label template.
    tier1.json              threshold, prompt set, source model, chunking, sha256 of model.onnx

The script then reloads `model.onnx` with onnxruntime and checks it finds the same spans as
PyTorch on `--check` dev records (scores within 1e-3).

ONNX inputs (batch, seq / words / spans dimensions are dynamic): `input_ids`,
`attention_mask`, `words_mask`, `text_lengths`, `span_idx`, `span_mask`; output `logits`
`[batch, words, max_width, labels]`. The prompt is `[CLS] <<ENT>> label1 <<ENT>> label2 ...
<<SEP>> word1 word2 ... [SEP]`, exactly as in `apps/agent/scripts/gliner/gliner.ts`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from .dataset.paths import ML_ROOT
from .tagger import GlinerTagger, TaggerConfig, prompt_set
from .tagger.model import MAX_TOKENS, SAFETY
from .tagger.prompts import one_per_type

#: The chosen tier 1 model (see results/tier1-gliner.md). A local fine-tuned checkpoint.
DEFAULT_MODEL = ML_ROOT / "models" / "tier1-small-ft"
DEFAULT_PROMPTS = "names"
DEFAULT_THRESHOLD = 0.6  # chosen on dev: best mean per-source F1 with red recall >= 95%
DEFAULT_OUT = ML_ROOT / "models" / "tier1-onnx"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parity(
    model: str, out: Path, prompts: str, threshold: float, n: int
) -> tuple[int, int, float]:
    """Spans from PyTorch vs onnxruntime on n dev records: (matched, total, max score diff)."""
    from .dataset.build import load_split

    recs = [r for r in load_split("dev") if r.spans][::97][:n]
    cfg = {"threshold": threshold, "prompts": prompts}
    torch_t = GlinerTagger(TaggerConfig(model=model, device="cpu", **cfg)).load()
    onnx_t = GlinerTagger(TaggerConfig(model=str(out), device="onnx", **cfg)).load()
    matched = total = 0
    worst = 0.0
    for r in recs:
        a = {(s.start, s.end, s.label): s.score for s in torch_t.predict(r.text)}
        b = {(s.start, s.end, s.label): s.score for s in onnx_t.predict(r.text)}
        total += max(len(a), len(b))
        both = a.keys() & b.keys()
        matched += len(both)
        worst = max([worst, *(abs(a[k] - b[k]) for k in both)])
    return matched, total, worst


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m safecontext_ml.export", description=__doc__.split("\n")[0]
    )
    p.add_argument("--model", default=str(DEFAULT_MODEL))
    # The prompt set must have one prompt per data type (the agent's labels.json format).
    p.add_argument(
        "--prompts", default=DEFAULT_PROMPTS, help="prompt set (tagger/prompts.py)"
    )
    p.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument(
        "--check",
        type=int,
        default=50,
        help="dev records for the parity check (0: skip)",
    )
    args = p.parse_args(argv)

    if args.model == str(DEFAULT_MODEL) and not DEFAULT_MODEL.exists():
        sys.exit(
            f"{DEFAULT_MODEL} not found. Build it first (needs data/splits, ~2 h on an M3 Max):\n"
            "  uv run python -m safecontext_ml.tagger.finetune --out models/tier1-small-ft\n"
            "or export an off-the-shelf model with --model urchade/gliner_small-v2.1 --prompts entity2"
        )
    from gliner import GLiNER

    model = GLiNER.from_pretrained(args.model)
    paths = model.export_to_onnx(args.out)
    print(paths, file=sys.stderr)

    prompt_map = prompt_set(args.prompts)
    labels = one_per_type(
        prompt_map
    )  # fails early for multi-prompt sets such as `fine`
    tok = model.data_processor.transformer_tokenizer
    cfg = model.config
    prompt_tokens = sum(
        len(tok(x, add_special_tokens=False)["input_ids"])
        for lab in prompt_map
        for x in (cfg.ent_token, lab)
    ) + len(tok(cfg.sep_token, add_special_tokens=False)["input_ids"])
    meta = {
        "schema_version": 1,
        "source_model": args.model,
        "prompt_set": args.prompts,
        "threshold": args.threshold,
        "flat_ner": True,
        "chunking": {
            "word_regex": r"\w+(?:[-_]\w+)*|\S",
            "max_tokens": MAX_TOKENS,
            "prompt_tokens": prompt_tokens,
            "token_budget": MAX_TOKENS - 2 - prompt_tokens - SAFETY,
            "max_words": int(cfg.max_len),
            "overlap_words": int(cfg.max_width),
        },
        "model_onnx_sha256": sha256(Path(paths["onnx_path"])),
    }
    (args.out / "labels.json").write_text(json.dumps(labels, indent=1) + "\n")
    (args.out / "tier1.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"wrote {args.out}/labels.json and tier1.json", file=sys.stderr)

    if args.check:
        matched, total, worst = parity(
            args.model, args.out, args.prompts, args.threshold, args.check
        )
        print(
            f"parity on {args.check} dev records: {matched}/{total} spans match, "
            f"max score difference {worst:.2e}",
            file=sys.stderr,
        )
        if matched != total or worst > 1e-3:
            sys.exit("ONNX export does not match PyTorch")
    print(args.out)


if __name__ == "__main__":
    main()
