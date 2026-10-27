"""labels.py must mirror DEFAULT_DATA_TYPES in packages/policy/src/defaults.ts."""

import re
from pathlib import Path

from safecontext_ml.dataset.labels import DATA_TYPES, RED_LABELS, SPAN_LABELS

DEFAULTS_TS = Path(__file__).resolve().parents[2] / "packages/policy/src/defaults.ts"


def parse_defaults() -> list[tuple[str, str, str, str]]:
    src = DEFAULTS_TS.read_text(encoding="utf-8")
    builtin = dict(re.findall(r"(\w+): '([^']+)'", src.split("as const")[0]))
    body = src.split("DEFAULT_DATA_TYPES: DataType[] = [", 1)[1].split("\n];", 1)[0]
    out = []
    for obj in re.findall(r"\{(.*?)\n\t\}", body, re.DOTALL):
        raw_id = re.search(r"id: (?:'([^']+)'|BUILTIN_DATA_TYPE\.(\w+))", obj)
        assert raw_id, obj
        type_id = raw_id.group(1) or builtin[raw_id.group(2)]
        name = re.search(r"name: '([^']+)'", obj).group(1)
        description = re.search(r"description: '([^']+)'", obj).group(1)
        tier = re.search(r"tier: '(\w+)'", obj).group(1)
        out.append((type_id, name, tier, description))
    return out


def test_matches_policy_defaults():
    expected = parse_defaults()
    assert len(expected) == 10
    assert [(d.id, d.name, d.tier, d.description) for d in DATA_TYPES] == expected


def test_span_labels_exclude_green():
    assert "public-docs" not in SPAN_LABELS
    assert set(RED_LABELS) == {
        "unreleased-roadmap",
        "secrets",
        "customer-personal-data",
    }
    assert len(SPAN_LABELS) == 7
