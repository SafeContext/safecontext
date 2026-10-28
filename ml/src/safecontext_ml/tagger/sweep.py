"""Score one predictions file at several thresholds (dev tuning).

    uv run python -m safecontext_ml.tagger.sweep results/preds/small-dev.jsonl --split dev \
        --per-source 500 --thresholds 0.2,0.3,0.4,0.5

Use the same sampling options as the `predict` run. Prints, per threshold and source: red recall,
micro F1, safe text flagged and hard negatives flagged. Never tune on `test`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..dataset.paths import SPLITS_DIR
from ..eval.classifier import Prediction
from ..eval.metrics import OVERALL, Scorer
from ..eval.run import Options, load


def pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.1f}"


def sweep(path: Path, records, thresholds: list[float]) -> list[tuple[float, Scorer]]:
    preds: dict[str, list[Prediction]] = {}
    with path.open() as f:
        for line in f:
            row = json.loads(line)
            preds[row["id"]] = [
                Prediction(s["start"], s["end"], s["label"], s.get("score", 1.0))
                for s in row["spans"]
            ]
    out = []
    for t in thresholds:
        sc = Scorer()
        for r in records:
            sc.add(r, [p for p in preds.get(r.id, []) if p.score >= t], None)
        out.append((t, sc))
    return out


def filter_file(src: Path, dest: Path, threshold: float) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with src.open() as f, dest.open("w") as out:
        for line in f:
            row = json.loads(line)
            row["spans"] = [s for s in row["spans"] if s.get("score", 1.0) >= threshold]
            out.write(json.dumps(row, ensure_ascii=False) + "\n")


def table(results: list[tuple[float, Scorer]]) -> str:
    lines = [
        "| Threshold | Source | Red recall | Micro P | Micro R | Micro F1 | Safe flagged | Hard neg flagged |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for t, sc in results:
        for src in [OVERALL, *sc.sources()]:
            g = sc.groups[src]
            m = g.total()
            lines.append(
                f"| {t:g} | {src} | {pct(g.red_recall)} | {pct(m.precision)} | {pct(m.recall)} | "
                f"{pct(m.f1)} | {pct(g.safe_fp_rate)} | {pct(g.hn_fp_rate)} |"
            )
    return "\n".join(lines)


def per_label(sc: Scorer, source: str) -> str:
    g = sc.groups[source]
    lines = [
        "| Label | Gold | Pred | P | R | F1 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, c in g.labels.items():
        if c.gold or c.pred:
            lines.append(
                f"| {label} | {c.gold} | {c.pred} | {pct(c.precision)} | {pct(c.recall)} | {pct(c.f1)} |"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m safecontext_ml.tagger.sweep")
    p.add_argument("predictions", type=Path)
    p.add_argument("--split", default="dev", choices=("train", "dev", "test"))
    p.add_argument("--splits-dir", type=Path, default=SPLITS_DIR)
    p.add_argument("--limit", type=int)
    p.add_argument("--per-source", type=int)
    p.add_argument("--source", action="append", default=[])
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--thresholds", default="0.2,0.3,0.4,0.5,0.6")
    p.add_argument("--labels", action="store_true", help="also print per-label tables")
    p.add_argument(
        "--write",
        type=Path,
        help="write the predictions with score >= --at to this file (for the harness) and exit",
    )
    p.add_argument("--at", type=float, help="threshold for --write")
    args = p.parse_args(argv)
    opts = Options(
        model="",
        split=args.split,
        splits_dir=args.splits_dir,
        limit=args.limit,
        per_source=args.per_source,
        sources=args.source,
        seed=args.seed,
    )
    if args.write:
        if args.at is None:
            p.error("--write needs --at")
        filter_file(args.predictions, args.write, args.at)
        return
    _, records, _, _ = load(opts)
    results = sweep(
        args.predictions, records, [float(t) for t in args.thresholds.split(",")]
    )
    print(table(results))
    if args.labels:
        for t, sc in results:
            for src in [OVERALL, *sc.sources()]:
                print(f"\n### threshold {t:g}, {src}\n\n{per_label(sc, src)}")


if __name__ == "__main__":
    main()
