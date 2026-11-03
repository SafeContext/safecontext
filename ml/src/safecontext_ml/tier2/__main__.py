"""`uv run python -m safecontext_ml.tier2 generalize|bench ...` (issue #14)."""

from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path

from ..eval import judge as J
from .generalize_eval import DEFAULT_LABELS, RESULTS_DIR


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    p = argparse.ArgumentParser(prog="python -m safecontext_ml.tier2")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser(
        "generalize",
        help="score generalize rewrites (no Claude unless --judge N --yes)",
    )
    g.add_argument(
        "model", help="RUNTIME:MODEL (ollama:qwen3.5:4b-q4_K_M, mlx:REPO) or `rules`"
    )
    g.add_argument("--split", default="test", choices=("train", "dev", "test"))
    g.add_argument(
        "--labels",
        default="+".join(DEFAULT_LABELS),
        help="data types to rewrite, joined with +",
    )
    g.add_argument("--limit", type=int, help="first N records only")
    g.add_argument(
        "--url",
        default="",
        help="runtime base URL (default: the runtime's local default)",
    )
    g.add_argument(
        "--zero-shot", action="store_true", help="leave out the few-shot examples"
    )
    g.add_argument(
        "--judge",
        type=int,
        default=0,
        metavar="N",
        help="task-preservation score on N records",
    )
    g.add_argument("--judge-model", default=J.DEFAULT_MODEL)
    g.add_argument("--judge-backend", choices=J.BACKENDS, default="claude-cli")
    g.add_argument(
        "--yes", action="store_true", help="actually send the judge requests"
    )
    g.add_argument("--out-dir", type=Path, default=RESULTS_DIR)
    g.add_argument("--no-save", action="store_true")

    b = sub.add_parser(
        "bench", help="cold start, latency and peak RAM per RUNTIME:MODEL"
    )
    b.add_argument("models", nargs="+")
    b.add_argument("--n", type=int, default=40, help="calls of each kind")
    b.add_argument("--url", default="")
    b.add_argument("--out", help="append JSON lines here")

    args = p.parse_args(argv)
    command = "uv run python -m safecontext_ml.tier2 " + shlex.join(argv)
    if args.cmd == "generalize":
        from . import generalize_eval as G

        s = G.run(
            args.model,
            split=args.split,
            labels=tuple(args.labels.split("+")),
            limit=args.limit,
            url=args.url,
            few_shot=not args.zero_shot,
            judge_n=args.judge,
            judge_model=args.judge_model,
            judge_backend=args.judge_backend,
            yes=args.yes,
        )
        print(G.render(s, command))
        if not args.no_save:
            print(
                f"wrote {G.save(s, command, args.out_dir)} and .json", file=sys.stderr
            )
    else:
        from .bench import main_bench

        main_bench(args.models, args.n, args.url, args.out)


if __name__ == "__main__":
    main()
