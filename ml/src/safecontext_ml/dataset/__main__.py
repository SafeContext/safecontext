"""CLI: `uv run python -m safecontext_ml.dataset <command>`. See ml/README.md."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from .paths import SOURCES_DIR, SPLITS_DIR


def _offline(args: argparse.Namespace) -> None:
    from .offline import SOURCE, generate
    from .schema import write_jsonl

    n = write_jsonl(
        SOURCES_DIR / f"{SOURCE}.jsonl", generate(args.docs_per_genre, args.seed)
    )
    print(f"wrote {n} records to {SOURCES_DIR / f'{SOURCE}.jsonl'}")


def _llm(args: argparse.Namespace) -> None:
    from .llm import SOURCE, run
    from .schema import write_jsonl

    records = run(
        args.n_per_genre,
        model=args.model,
        effort=args.effort,
        seed=args.seed,
        yes=args.yes,
        dry_run=args.dry_run,
        max_requests=args.max_requests,
        workers=args.workers,
    )
    n = write_jsonl(SOURCES_DIR / f"{SOURCE}.jsonl", records)
    print(
        f"wrote {n} records (cached responses only) to {SOURCES_DIR / f'{SOURCE}.jsonl'}"
    )


def _public(args: argparse.Namespace) -> None:
    from .public import SOURCES, convert, download
    from .schema import write_jsonl

    if args.action == "list":
        for s in SOURCES.values():
            print(
                f"{s.name}: {s.repo_id} ({s.licence}, ~{s.download_bytes / 1e6:.0f} MB) - {s.rows}"
            )
        return
    if not args.name:
        raise SystemExit("name required")
    if args.action == "download":
        print(f"downloaded to {download(args.name, args.yes)}")
    else:
        out = SOURCES_DIR / f"{args.name}.jsonl"
        print(
            f"wrote {write_jsonl(out, convert(args.name, args.limit))} records to {out}"
        )


def _build(args: argparse.Namespace) -> None:
    from .build import build

    manifest = build(refreeze=args.refreeze)
    for split, info in manifest["splits"].items():
        print(
            f"{split:5s} {info['records']:7d} records, {info['hard_negatives']:6d} hard negatives"
        )
    print(f"manifest: {SPLITS_DIR / 'manifest.json'}")


def _stats(args: argparse.Namespace) -> None:
    from .schema import read_jsonl, validate

    for path in args.files:
        recs = list(read_jsonl(Path(path)))
        bad = sum(bool(validate(r)) for r in recs)
        spans = Counter(s.label for r in recs for s in r.spans)
        print(f"{path}: {len(recs)} records, {bad} invalid")
        print(json.dumps(dict(spans.most_common()), indent=2))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m safecontext_ml.dataset")
    sub = p.add_subparsers(dest="cmd", required=True)

    o = sub.add_parser(
        "offline", help="generate the template-based Macrohard corpus (free)"
    )
    o.add_argument("--docs-per-genre", type=int, default=200)
    o.add_argument("--seed", type=int, default=0)
    o.set_defaults(func=_offline)

    m = sub.add_parser(
        "llm", help="generate Macrohard documents with Claude (costs money with --yes)"
    )
    m.add_argument("--n-per-genre", type=int, default=100)
    m.add_argument("--model", default="claude-sonnet-5-5")
    m.add_argument("--effort", default="medium", choices=("low", "medium", "high"))
    m.add_argument("--seed", type=int, default=0)
    m.add_argument("--max-requests", type=int)
    m.add_argument("--workers", type=int, default=4)
    m.add_argument("--dry-run", action="store_true", help="print sample prompts")
    m.add_argument("--yes", action="store_true", help="actually call the API")
    m.set_defaults(func=_llm)

    u = sub.add_parser("public", help="public PII datasets")
    u.add_argument("action", choices=("list", "download", "convert"))
    u.add_argument("name", nargs="?")
    u.add_argument("--limit", type=int)
    u.add_argument("--yes", action="store_true", help="actually download")
    u.set_defaults(func=_public)

    b = sub.add_parser("build", help="merge sources into train/dev/test")
    b.add_argument(
        "--refreeze", action="store_true", help="allow the test split to change"
    )
    b.set_defaults(func=_build)

    s = sub.add_parser("stats", help="validate and count labels in JSONL files")
    s.add_argument("files", nargs="+")
    s.set_defaults(func=_stats)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
