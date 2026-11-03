"""Where dataset files live. Override the root with `SC_ML_DATA_DIR`.

ml/data/
  raw/            downloads and LLM response cache (gitignored at the repo root)
    public/<name>/  public datasets, as downloaded
    llm-cache/<model>/<sha256>.json
  sources/        one normalised JSONL file per source (gitignored in ml/.gitignore)
  splits/         train.jsonl, dev.jsonl, test.jsonl, manifest.json (gitignored in ml/.gitignore)
  llm-test/       llm-test.jsonl, manifest.json: a scored set kept out of `build` (issue #76)
"""

from __future__ import annotations

import os
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("SC_ML_DATA_DIR", ML_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
PUBLIC_RAW_DIR = RAW_DIR / "public"
LLM_CACHE_DIR = RAW_DIR / "llm-cache"
SOURCES_DIR = DATA_DIR / "sources"
SPLITS_DIR = DATA_DIR / "splits"

#: Scored sets that `build` never touches, by name: `<data dir>/<name>/<name>.jsonl`. Score one
#: with `--split NAME`. `llm-test` holds realistic Claude-written documents (issue #76).
EXTRA_SETS = ("llm-test",)
SET_NAMES = ("train", "dev", "test", *EXTRA_SETS)
LLM_TEST_DIR = DATA_DIR / "llm-test"


def split_path(split: str, splits_dir: Path = SPLITS_DIR) -> Path:
    """The JSONL file of a split (`splits/<split>.jsonl`) or extra set (`<name>/<name>.jsonl`,
    next to `splits_dir`)."""
    if split in EXTRA_SETS:
        return splits_dir.parent / split / f"{split}.jsonl"
    if split not in SET_NAMES:
        raise ValueError(f"unknown split {split!r}; known: {', '.join(SET_NAMES)}")
    return splits_dir / f"{split}.jsonl"
