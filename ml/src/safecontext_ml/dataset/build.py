"""Merge every source file into train / dev / test, with a manifest and a frozen test split."""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .labels import SPAN_LABELS
from .paths import SOURCES_DIR, SPLITS_DIR
from .schema import SCHEMA_VERSION, Record, dumps, read_jsonl, validate
from .split import RATIOS, SALT, SPLITS, Split, assign_split

_PRIORITY: dict[Split, int] = {"test": 0, "dev": 1, "train": 2}


class FrozenTestError(RuntimeError):
    pass


def _sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def _stats(records: list[Record]) -> dict[str, Any]:
    spans = Counter(s.label for r in records for s in r.spans)
    return {
        "records": len(records),
        "hard_negatives": sum(r.hard_negative for r in records),
        "records_without_spans": sum(not r.spans for r in records),
        "spans": {label: spans.get(label, 0) for label in SPAN_LABELS},
        "by_source": dict(sorted(Counter(r.source for r in records).items())),
        "by_genre": dict(sorted(Counter(r.genre for r in records).items())),
    }


def build(
    sources_dir: Path = SOURCES_DIR,
    out_dir: Path = SPLITS_DIR,
    refreeze: bool = False,
) -> dict[str, Any]:
    source_files = sorted(sources_dir.glob("*.jsonl"))
    if not source_files:
        raise SystemExit(f"no source files in {sources_dir}; generate some first")

    records: list[Record] = []
    errors: list[str] = []
    source_info: dict[str, Any] = {}
    for path in source_files:
        n = 0
        for rec in read_jsonl(path):
            errors.extend(f"{path.name} {rec.id}: {e}" for e in validate(rec))
            records.append(rec)
            n += 1
        source_info[path.name] = {"records": n, "sha256": _sha256(path.read_text(encoding="utf-8"))}
    if errors:
        raise ValueError("invalid records:\n" + "\n".join(errors[:20]))

    ids = Counter(r.id for r in records)
    dupes = [i for i, c in ids.items() if c > 1]
    if dupes:
        raise ValueError(f"duplicate ids: {dupes[:10]}")

    # Assign splits, then drop exact-text duplicates so the same text never sits in two splits
    # (the copy in the most protected split wins: test, then dev, then train).
    by_split: dict[Split, list[Record]] = defaultdict(list)
    for rec in sorted(records, key=lambda r: (_PRIORITY[assign_split(r.group)], r.id)):
        by_split[assign_split(rec.group)].append(rec)
    seen: set[str] = set()
    dropped = 0
    final: dict[Split, list[Record]] = {}
    for split in ("test", "dev", "train"):
        keep = []
        for rec in by_split[split]:
            key = _norm(rec.text)
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            keep.append(rec)
        final[split] = sorted(keep, key=lambda r: r.id)

    contents = {s: "".join(dumps(r) + "\n" for r in final[s]) for s in SPLITS}

    test_path = out_dir / "test.jsonl"
    if test_path.exists() and not refreeze:
        old = _sha256(test_path.read_text(encoding="utf-8"))
        if old != _sha256(contents["test"]):
            raise FrozenTestError(
                f"{test_path} is frozen and the new build would change it. If that is intended "
                "(new data, changed generator), re-run with --refreeze and say so in the PR."
            )

    out_dir.mkdir(parents=True, exist_ok=True)
    for split in SPLITS:
        (out_dir / f"{split}.jsonl").write_text(contents[split], encoding="utf-8", newline="\n")

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "split": {"salt": SALT, "ratios": RATIOS, "key": "record.group"},
        "labels": list(SPAN_LABELS),
        "sources": source_info,
        "dropped_duplicate_texts": dropped,
        "splits": {s: {"sha256": _sha256(contents[s]), **_stats(final[s])} for s in SPLITS},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def load_split(split: Split, splits_dir: Path = SPLITS_DIR) -> list[Record]:
    """Load one split. The entry point for the evaluation harness (#12) and training (#13)."""
    return list(read_jsonl(splits_dir / f"{split}.jsonl"))
