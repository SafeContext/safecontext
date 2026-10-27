"""Run one classifier over a split and produce the report (`python -m safecontext_ml.eval`)."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import random
import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..dataset.paths import ML_ROOT, SPLITS_DIR
from ..dataset.schema import Record, read_jsonl
from . import judge as J
from .adapters import load_classifier
from .classifier import AdapterContext, Classifier, Doc, Prediction
from .metrics import Scorer
from .report import RunInfo, render

RESULTS_DIR = ML_ROOT / "results"


@dataclass
class Options:
    model: str
    split: str = "test"
    splits_dir: Path = SPLITS_DIR
    limit: int | None = None
    per_source: int | None = None
    sources: list[str] = field(default_factory=list)
    seed: int = 0
    warmup: int = 3
    out_dir: Path | None = RESULTS_DIR
    save_predictions: Path | None = None
    adapter_options: dict[str, Any] = field(default_factory=dict)
    judge: int = 0
    judge_model: str = J.DEFAULT_MODEL
    yes: bool = False
    command: str = ""


def sample(records: list[Record], opts: Options) -> tuple[list[Record], str]:
    """Filter and sample, deterministically (seeded). Keeps the split's order."""
    notes = []
    if opts.sources:
        records = [r for r in records if r.source in opts.sources]
        notes.append("sources " + ", ".join(opts.sources))
    rng = random.Random(opts.seed)
    if opts.per_source is not None:
        by_source: dict[str, list[int]] = {}
        for i, r in enumerate(records):
            by_source.setdefault(r.source, []).append(i)
        keep: set[int] = set()
        for idx in by_source.values():
            keep.update(
                idx if len(idx) <= opts.per_source else rng.sample(idx, opts.per_source)
            )
        records = [r for i, r in enumerate(records) if i in keep]
        notes.append(f"at most {opts.per_source:,} per source")
    if opts.limit is not None and len(records) > opts.limit:
        keep = set(rng.sample(range(len(records)), opts.limit))
        records = [r for i, r in enumerate(records) if i in keep]
        notes.append(f"random {opts.limit:,}")
    if notes:
        notes.append(f"seed {opts.seed}")
    return records, ", ".join(notes) or "all records"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _machine() -> str:
    chip = platform.processor() or platform.machine()
    if sys.platform == "darwin":
        try:
            chip = (
                subprocess.run(
                    ["sysctl", "-n", "machdep.cpu.brand_string"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                    check=False,
                ).stdout.strip()
                or chip
            )
        except OSError:
            pass
    return f"{chip}, {os.cpu_count()} cores, {platform.system()} {platform.release()}, Python {platform.python_version()}"


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-") or "model"


def predict_all(
    clf: Classifier, records: list[Record], warmup: int
) -> tuple[dict[str, list[Prediction]], dict[str, float | None]]:
    clf.setup()
    for r in records[:warmup]:
        clf.predict(Doc(r.id, r.text))
    preds: dict[str, list[Prediction]] = {}
    latency: dict[str, float | None] = {}
    for i, r in enumerate(records, 1):
        doc = Doc(r.id, r.text)
        t0 = time.perf_counter_ns()
        p = clf.predict(doc)
        elapsed = (time.perf_counter_ns() - t0) / 1e6
        preds[r.id] = p
        latency[r.id] = clf.latency_ms(doc) if clf.reports_own_latency else elapsed
        if i % 5000 == 0:
            print(f"  {i:,}/{len(records):,} records", file=sys.stderr)
    return preds, latency


def write_predictions(path: Path, records: list[Record], preds, latency) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            row = {
                "id": r.id,
                "spans": [
                    {"start": p.start, "end": p.end, "label": p.label, "score": p.score}
                    for p in preds[r.id]
                ],
            }
            if latency.get(r.id) is not None:
                row["latency_ms"] = round(latency[r.id], 4)
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_inputs(path: Path, records: list[Record]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps({"id": r.id, "text": r.text}, ensure_ascii=False) + "\n")


def load(opts: Options) -> tuple[list[Record], list[Record], Path, str]:
    path = opts.splits_dir / f"{opts.split}.jsonl"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Build the dataset first: python -m safecontext_ml.dataset build"
        )
    everything = list(read_jsonl(path))
    records, sampling = sample(everything, opts)
    return everything, records, path, sampling


def run(opts: Options) -> tuple[str, dict[str, Any]]:
    everything, records, path, sampling = load(opts)
    if not records:
        raise ValueError("no records to score (check --source / --limit)")

    clf = load_classifier(opts.model, AdapterContext(records, opts.adapter_options))
    print(
        f"scoring {clf.name} on {len(records):,} {opts.split} records", file=sys.stderr
    )
    preds, latency = predict_all(clf, records, opts.warmup)

    scorer = Scorer()
    for r in records:
        scorer.add(r, preds[r.id], latency[r.id])

    judge_summary = None
    if opts.judge:
        items = J.select(records, preds, opts.judge, opts.seed)
        judge_summary = J.run(items, opts.judge_model, yes=opts.yes)

    manifest = opts.splits_dir / "manifest.json"
    manifest_sha = None
    if manifest.exists():
        manifest_sha = (
            json.loads(manifest.read_text())
            .get("splits", {})
            .get(opts.split, {})
            .get("sha256")
        )
    warnings = list(getattr(clf, "warnings", list)())
    if scorer.overall.dropped_invalid:
        warnings.append(
            f"{scorer.overall.dropped_invalid:,} predictions had invalid offsets or labels and were dropped"
        )
    if clf.reports_own_latency:
        latency_source = "as recorded by the classifier (not measured here)"
    elif not scorer.overall.latencies_ms:
        latency_source = "not measured"
    else:
        latency_source = f"wall-clock per `predict()` call, one document at a time, after {opts.warmup} warm-up calls"
    info = RunInfo(
        model=clf.name,
        split=opts.split,
        split_sha256=_sha256(path),
        manifest_sha256=manifest_sha,
        records_in_split=len(everything),
        sampling=sampling,
        command=opts.command,
        date=datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        machine=_machine(),
        model_labels=tuple(clf.labels),
        latency_source=latency_source,
        warnings=warnings,
    )
    report = render(scorer, info, judge_summary)
    data = {
        "model": clf.name,
        "spec": opts.model,
        "split": opts.split,
        "split_sha256": info.split_sha256,
        "sampling": sampling,
        "command": opts.command,
        "date": info.date,
        "machine": info.machine,
        "groups": {k: g.to_json() for k, g in scorer.groups.items()},
        "judge": None if judge_summary is None else judge_summary.to_json(),
    }

    if opts.save_predictions:
        write_predictions(opts.save_predictions, records, preds, latency)
    if opts.out_dir is not None:
        name = slug(
            f"{clf.name}-{opts.split}"
            + ("" if sampling == "all records" else "-sample")
        )
        opts.out_dir.mkdir(parents=True, exist_ok=True)
        (opts.out_dir / f"{name}.md").write_text(report, encoding="utf-8")
        (opts.out_dir / f"{name}.json").write_text(
            json.dumps(data, indent=1), encoding="utf-8"
        )
        print(f"wrote {opts.out_dir / name}.md and .json", file=sys.stderr)
    return report, data


def command_line(argv: list[str]) -> str:
    return "uv run python -m safecontext_ml.eval " + shlex.join(argv)
