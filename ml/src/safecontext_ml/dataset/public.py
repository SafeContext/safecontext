"""Public PII datasets: download (needs `--yes`) and convert to our record format.

Only datasets whose licence allows commercial use are listed. Licences, sizes and the ones we
rejected are in `ml/data/LICENCES.md`. Downloads are pinned to a commit so conversions are
reproducible.

Their labels are mapped onto our data types with `LABEL_MAP`. A label mapped to None, or not in
the map, becomes an `ignore` region: sensitive in the source but outside our taxonomy, so it is
neither rewarded nor penalised when scoring.
"""

from __future__ import annotations

import ast
import json
import sys
from collections import Counter
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import labels as L
from .paths import PUBLIC_RAW_DIR
from .schema import Record, Span, validate

# Source label (lower case) -> our data type id, or None to ignore.
LABEL_MAP: dict[str, str | None] = {
    # Contact details and identifiers of people
    **dict.fromkeys(
        (
            "email", "phone_number", "phone", "fax_number", "street_address", "address",
            "credit_card_number", "credit_card_security_code", "cvv", "ssn", "national_id",
            "passport_number", "driver_license_number", "date_of_birth", "first_name", "last_name",
            "name", "ipv4", "ipv6", "iban", "bban", "account_number", "bank_routing_number",
            "tax_id", "medical_record_number", "health_plan_beneficiary_number", "user_name",
            "customer_id", "license_plate", "biometric_identifier", "local_latlng", "coordinate",
            "device_identifier", "vehicle_identifier", "certificate_license_number",
        ),
        L.PERSONAL,
    ),
    # Credentials
    **dict.fromkeys(("api_key", "password", "pin", "account_pin"), L.SECRET),
    # Sensitive or quasi-identifying in the source, but no matching data type here.
    **dict.fromkeys(
        (
            "date", "time", "date_time", "city", "state", "country", "postcode", "company",
            "company_name", "url", "employee_id", "swift_bic", "swift_bic_code",
            "unique_identifier", "age", "gender", "employment_status", "blood_type", "occupation",
        ),
        None,
    ),
}  # fmt: skip


@dataclass(frozen=True)
class PublicSource:
    name: str
    repo_id: str
    revision: str
    licence: str
    rows: str
    download_bytes: int
    allow_patterns: tuple[str, ...]
    convert: Callable[[PublicSource, Path, Counter[str]], Iterator[Record]]


def _parquet_rows(root: Path) -> Iterator[dict[str, Any]]:
    import pyarrow.parquet as pq  # lazy: only needed for public data

    for path in sorted(root.rglob("*.parquet")):
        table = pq.read_table(path)
        yield from table.to_pylist()


def _literal(value: Any) -> Any:
    """Parse a field that may be a list, a JSON string or a Python-literal string."""
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return ast.literal_eval(value)


def _trim(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def build_record(
    source: str,
    uid: str,
    text: str,
    raw_spans: list[tuple[int, int, str]],
    meta: dict[str, Any],
    unmapped: Counter[str],
) -> Record | None:
    """Map (start, end, source_label) spans onto our labels; drop overlaps; validate."""
    spans: list[Span] = []
    ignore: list[Span] = []
    for start, end, label in sorted(raw_spans, key=lambda s: (s[0], -(s[1] - s[0]))):
        start, end = _trim(text, start, end)
        if not (0 <= start < end <= len(text)):
            continue
        key = label.lower()
        target = LABEL_MAP.get(key)
        if key not in LABEL_MAP:
            unmapped[key] += 1
        span = Span(start, end, target or label, text[start:end])
        if target is None:
            ignore.append(span)
        elif spans and start < spans[-1].end:
            continue  # overlaps the previous (longer or earlier) span
        else:
            spans.append(span)
    ignore = [g for g in ignore if not any(g.start < s.end and s.start < g.end for s in spans)]
    rec = Record(
        id=f"{source}-{uid}",
        text=text,
        spans=spans,
        source=source,
        group=f"{source}:{uid}",
        genre="public-pii",
        ignore=ignore,
        meta=meta,
    )
    return None if validate(rec) else rec


def _convert_nemotron(src: PublicSource, root: Path, unmapped: Counter[str]) -> Iterator[Record]:
    for row in _parquet_rows(root):
        spans = [(int(s["start"]), int(s["end"]), str(s["label"])) for s in _literal(row["spans"])]
        meta = {k: row.get(k) for k in ("domain", "document_type", "document_format", "locale")}
        rec = build_record(src.name, str(row["uid"]), row["text"], spans, meta, unmapped)
        if rec:
            yield rec


def _convert_gretel_finance(src: PublicSource, root: Path, unmapped: Counter[str]) -> Iterator[Record]:
    for i, row in enumerate(_parquet_rows(root)):
        if not str(row.get("language", "")).lower().startswith("en"):
            continue  # English only for now
        spans = [(int(s["start"]), int(s["end"]), str(s["label"])) for s in _literal(row["pii_spans"])]
        meta = {k: row.get(k) for k in ("document_type", "domain", "language")}
        uid = str(row.get("index", i))
        rec = build_record(src.name, uid, row["generated_text"], spans, meta, unmapped)
        if rec:
            yield rec


def _convert_gretel_en(src: PublicSource, root: Path, unmapped: Counter[str]) -> Iterator[Record]:
    # This dataset lists entity strings without offsets, so we locate every occurrence.
    for row in _parquet_rows(root):
        text: str = row["text"]
        spans: list[tuple[int, int, str]] = []
        for ent in _literal(row["entities"]):
            value, types = str(ent["entity"]), [str(t) for t in ent.get("types", [])]
            if not value.strip() or not types:
                continue
            label = next((t for t in types if LABEL_MAP.get(t.lower())), types[0])
            start = text.find(value)
            while start != -1:
                spans.append((start, start + len(value), label))
                start = text.find(value, start + len(value))
        meta = {k: row.get(k) for k in ("domain", "document_type")} | {"offsets": "string-match"}
        rec = build_record(src.name, str(row["uid"]), text, spans, meta, unmapped)
        if rec:
            yield rec


SOURCES: dict[str, PublicSource] = {
    s.name: s
    for s in (
        PublicSource(
            name="nemotron-pii",
            repo_id="nvidia/Nemotron-PII",
            revision="b70ffaf5ff39e079776134c5bf4381f00a9fd1ed",
            licence="CC-BY-4.0",
            rows="100,000 (50k train + 50k test), English, 55+ labels",
            download_bytes=307_302_727,
            allow_patterns=("data/*.parquet", "README.md"),
            convert=_convert_nemotron,
        ),
        PublicSource(
            name="gretel-pii-finance",
            repo_id="gretelai/synthetic_pii_finance_multilingual",
            revision="7b844d16738527a04264f50214cb426a4cea0897",
            licence="Apache-2.0",
            rows="55,940 (7 languages; English kept), 29 labels",
            download_bytes=368_583_414,
            allow_patterns=("data/*.parquet", "README.md"),
            convert=_convert_gretel_finance,
        ),
        PublicSource(
            name="gretel-pii-en",
            repo_id="gretelai/gretel-pii-masking-en-v1",
            revision="e06eb1499ca8d54470f085021cd8e54f9efac7fd",
            licence="Apache-2.0",
            rows="~60,000 (50k train, 5k validation, 5k test), 42 labels, no offsets",
            download_bytes=151_003_313,
            allow_patterns=("data/*.parquet", "README.md"),
            convert=_convert_gretel_en,
        ),
    )
}


def download(name: str, yes: bool) -> Path:
    src = SOURCES[name]
    dest = PUBLIC_RAW_DIR / name
    if not yes:
        raise SystemExit(
            f"Would download {src.repo_id}@{src.revision[:8]} ({src.licence}, "
            f"~{src.download_bytes / 1e6:.0f} MB) to {dest}. Re-run with --yes to download."
        )
    from huggingface_hub import snapshot_download  # lazy

    snapshot_download(
        repo_id=src.repo_id,
        repo_type="dataset",
        revision=src.revision,
        local_dir=dest,
        allow_patterns=list(src.allow_patterns),
    )
    return dest


def convert(name: str, limit: int | None = None) -> Iterator[Record]:
    src = SOURCES[name]
    root = PUBLIC_RAW_DIR / name
    if not root.exists():
        raise SystemExit(f"{root} not found; run `public download {name} --yes` first.")
    unmapped: Counter[str] = Counter()
    for n, rec in enumerate(src.convert(src, root, unmapped)):
        if limit is not None and n >= limit:
            break
        yield rec
    if unmapped:
        top = ", ".join(f"{k}={v}" for k, v in unmapped.most_common(20))
        print(f"{name}: labels not in LABEL_MAP (kept as ignore regions): {top}", file=sys.stderr)
