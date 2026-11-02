"""`uv run python -m safecontext_ml.eval <model>`: score a classifier and print the report."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..dataset.paths import SPLITS_DIR
from . import judge as J
from .adapters import ADAPTERS
from .run import RESULTS_DIR, Options, command_line, load, run, write_inputs


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    p = argparse.ArgumentParser(
        prog="python -m safecontext_ml.eval",
        description="Score a classifier on a dataset split. Models: "
        + "; ".join(f"{k}: {v[1]}" for k, v in ADAPTERS.items()),
    )
    p.add_argument(
        "model", nargs="?", help="model spec, e.g. regex or predictions:FILE"
    )
    p.add_argument("--split", default="test", choices=("train", "dev", "test"))
    p.add_argument(
        "--splits-dir", type=Path, default=SPLITS_DIR, help=argparse.SUPPRESS
    )
    p.add_argument(
        "--limit", type=int, help="score a seeded random sample of N records"
    )
    p.add_argument("--per-source", type=int, help="at most N records from each source")
    p.add_argument(
        "--source", action="append", default=[], help="only this source (repeatable)"
    )
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--warmup", type=int, default=3, help="untimed predict() calls before timing"
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=RESULTS_DIR,
        help="where to write the .md/.json report",
    )
    p.add_argument("--no-save", action="store_true", help="print the report only")
    p.add_argument(
        "--save-predictions", type=Path, help="also write predictions as JSONL"
    )
    p.add_argument(
        "--write-inputs",
        type=Path,
        help="write {id, text} JSONL for the selected records and exit",
    )
    p.add_argument(
        "--pred-offsets",
        choices=("codepoint", "utf16"),
        default="codepoint",
        help="predictions:FILE offsets (utf16 for JavaScript output)",
    )
    p.add_argument(
        "--allow-missing",
        action="store_true",
        help="predictions:FILE: score records missing from the file as 'predicted nothing'",
    )
    p.add_argument(
        "--judge",
        type=int,
        default=0,
        metavar="N",
        help="task-preservation score on N records (PAID; estimate only without --yes)",
    )
    p.add_argument("--judge-model", default=J.DEFAULT_MODEL)
    p.add_argument(
        "--yes", action="store_true", help="actually send the paid judge requests"
    )
    args = p.parse_args(argv)

    opts = Options(
        model=args.model or "",
        split=args.split,
        splits_dir=args.splits_dir,
        limit=args.limit,
        per_source=args.per_source,
        sources=args.source,
        seed=args.seed,
        warmup=args.warmup,
        out_dir=None if args.no_save else args.out_dir,
        save_predictions=args.save_predictions,
        adapter_options={
            "pred_offsets": args.pred_offsets,
            "allow_missing": args.allow_missing,
        },
        judge=args.judge,
        judge_model=args.judge_model,
        yes=args.yes,
        command=command_line(argv),
    )
    if args.write_inputs:
        _, records, _, _ = load(opts)
        write_inputs(args.write_inputs, records)
        print(f"wrote {len(records):,} records to {args.write_inputs}", file=sys.stderr)
        return
    if not args.model:
        p.error("model is required (or pass --write-inputs)")
    report, _ = run(opts)
    print(report)


if __name__ == "__main__":
    main()
