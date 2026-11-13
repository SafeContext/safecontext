# /// script
# requires-python = ">=3.14,<3.15"
# dependencies = ["huggingface-hub==1.33.0"]
# ///
"""Download-only entry point; uv uses download.py.lock, not the Mac training project."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Reuse the team's manifest, checks and downloader directly, without installing the ML package.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "pull", "login"))
    args = parser.parse_args(argv)
    if sys.version_info[:2] != (3, 14):
        parser.error("use Python 3.14, or `uv run --locked ml/download.py status`")
    from safecontext_ml import artifacts as A

    try:
        if args.command == "login":
            from huggingface_hub import login

            try:
                login(add_to_git_credential=False)
            except Exception:  # noqa: BLE001 - auth exceptions can contain credentials
                print(
                    "error: login failed; check your own Hugging Face account and read access",
                    file=sys.stderr,
                )
                return 1
            return 0
        arts = {"tier1-onnx": A.load_lock()["tier1-onnx"]}
        art = arts["tier1-onnx"]
        print(
            f"tier1-onnx: {len(art.files)} files, {sum(f.size for f in art.files):,} bytes"
        )
        if args.command == "pull":
            A.pull(arts, ["tier1-onnx"])
        rows = A.status_rows(arts)
        row = rows[0]
        ready = row["ready"] == "yes"
        print(
            f"{'VERIFIED' if ready else 'NOT READY'}: {row['local']}; {row['checksum']}"
        )
        print(f"Model directory: {art.target()}")
        return 0 if ready else 2
    except A.ArtifactError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except OSError:
        print(
            "error: cannot access model files; check permissions, disk space and file locks",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
