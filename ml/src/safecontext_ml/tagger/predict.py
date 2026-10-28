"""Batch-predict a split with GLiNER and write a predictions file the harness can score.

    uv run python -m safecontext_ml.tagger.predict MODEL_SPEC --split dev --per-source 500 \
        --out results/preds/small-dev.jsonl
    uv run python -m safecontext_ml.eval predictions:results/preds/small-dev.jsonl --split dev ...

MODEL_SPEC is the part after `gliner:` in the harness (`urchade/gliner_small-v2.1,device=mps`).
Many documents go through the model at once, so this is much faster than the harness's
one-document-at-a-time loop, especially on the Apple GPU. It records no latency: measure
latency with the harness on a sample (`gliner:...` directly).

Run at a low threshold (e.g. 0.1) once and sweep higher thresholds with
`python -m safecontext_ml.tagger.sweep`: greedy flat decoding means the spans at threshold t
are exactly the spans at a lower threshold with score >= t.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from ..dataset.paths import SPLITS_DIR
from ..eval.adapters.gliner import parse
from ..eval.run import Options, load
from .model import GlinerTagger


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m safecontext_ml.tagger.predict")
    p.add_argument(
        "model", help="gliner model spec, e.g. urchade/gliner_small-v2.1,device=mps"
    )
    p.add_argument("--split", default="dev", choices=("train", "dev", "test"))
    p.add_argument("--splits-dir", type=Path, default=SPLITS_DIR)
    p.add_argument("--limit", type=int)
    p.add_argument("--per-source", type=int)
    p.add_argument("--source", action="append", default=[])
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--docs-per-call", type=int, default=64)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args(argv)

    cfg, _ = parse(args.model)
    opts = Options(
        model="",
        split=args.split,
        splits_dir=args.splits_dir,
        limit=args.limit,
        per_source=args.per_source,
        sources=args.source,
        seed=args.seed,
    )
    _, records, _, sampling = load(opts)
    tagger = GlinerTagger(cfg).load()
    print(
        f"{cfg.model}: {len(records):,} {args.split} records ({sampling})",
        file=sys.stderr,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with args.out.open("w", encoding="utf-8") as f:
        for i in range(0, len(records), args.docs_per_call):
            batch = records[i : i + args.docs_per_call]
            for r, spans in zip(
                batch, tagger.predict_many([r.text for r in batch]), strict=True
            ):
                row = {
                    "id": r.id,
                    "spans": [
                        {
                            "start": s.start,
                            "end": s.end,
                            "label": s.label,
                            "score": round(s.score, 5),
                        }
                        for s in spans
                    ],
                }
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            done = i + len(batch)
            if done % (args.docs_per_call * 20) == 0 or done == len(records):
                rate = done / max(time.time() - t0, 1e-9)
                print(
                    f"  {done:,}/{len(records):,} ({rate:.1f} docs/s)", file=sys.stderr
                )
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
