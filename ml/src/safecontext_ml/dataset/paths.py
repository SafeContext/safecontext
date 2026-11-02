"""Where dataset files live. Override the root with `SC_ML_DATA_DIR`.

ml/data/
  raw/            downloads and LLM response cache (gitignored at the repo root)
    public/<name>/  public datasets, as downloaded
    llm-cache/<model>/<sha256>.json
  sources/        one normalised JSONL file per source (gitignored in ml/.gitignore)
  splits/         train.jsonl, dev.jsonl, test.jsonl, manifest.json (gitignored in ml/.gitignore)
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
