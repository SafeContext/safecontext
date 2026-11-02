import json

import pytest

from safecontext_ml.dataset.markup import MarkupError, parse, to_markup
from safecontext_ml.dataset.schema import (
    Record,
    Span,
    dumps,
    read_jsonl,
    validate,
    write_jsonl,
)
from safecontext_ml.dataset.split import RATIOS, assign_split, bucket, partition


def make(text: str, spans: list[Span], **kw) -> Record:
    return Record(
        id="r1", text=text, spans=spans, source="t", group="g", genre="x", **kw
    )


# --- schema ---


def test_valid_record_round_trips(tmp_path):
    text = "Bluefin Logistics paid $1.2M"
    rec = make(
        text,
        [
            Span(0, 17, "customer-names", "Bluefin Logistics"),
            Span(23, 28, "deal-sizes", "$1.2M"),
        ],
        meta={"k": 1},
    )
    assert validate(rec) == []
    path = tmp_path / "r.jsonl"
    write_jsonl(path, [rec])
    (back,) = read_jsonl(path)
    assert back == rec
    assert json.loads(dumps(rec))["spans"][1] == {
        "start": 23,
        "end": 28,
        "label": "deal-sizes",
        "text": "$1.2M",
    }


@pytest.mark.parametrize(
    ("spans", "problem"),
    [
        ([Span(0, 4, "secrets", "abcd")], "is 'key "),
        ([Span(0, 3, "colour", "key")], "unknown label"),
        ([Span(0, 40, "secrets", "key")], "outside text"),
        ([Span(0, 4, "secrets", "key ")], "whitespace"),
        ([Span(4, 7, "secrets", "abc"), Span(0, 3, "secrets", "key")], "out of order"),
    ],
)
def test_invalid_spans(spans, problem):
    errors = validate(make("key abc", spans))
    assert any(problem in e for e in errors), errors


def test_negative_for_must_not_be_present():
    rec = make("key abc", [Span(4, 7, "secrets", "abc")], negative_for=["secrets"])
    assert any("negative_for" in e for e in validate(rec))
    assert make("key abc", [], negative_for=["secrets"]).hard_negative


def test_ignore_must_not_overlap_spans():
    rec = make(
        "key abc",
        [Span(4, 7, "secrets", "abc")],
        ignore=[Span(0, 7, "date", "key abc")],
    )
    assert any("ignore[0]" in e for e in validate(rec))


# --- split ---


def test_split_is_stable():
    # Pinned: changing the hash, salt or ratios reshuffles every split. Don't.
    assert bucket("a") == 13
    assert bucket("mh-offline-code-00000") == 56
    assert assign_split("nemotron-pii:abc") == "train"


def test_split_ratios_roughly_hold():
    counts = {"train": 0, "dev": 0, "test": 0}
    for i in range(20_000):
        counts[assign_split(f"k{i}")] += 1
    for split, pct in RATIOS.items():
        assert abs(counts[split] / 200 - pct) < 1.5, counts


def test_partition_is_disjoint_and_complete():
    values = [f"v{i}" for i in range(500)]
    parts = [set(partition("pool", values, s)) for s in ("train", "dev", "test")]
    assert set().union(*parts) == set(values)
    assert sum(len(p) for p in parts) == len(values)


# --- markup ---


def test_markup_parse_and_inverse():
    marked = "Hi <customer-personal-data>Ana Lee</customer-personal-data>, key <secrets>sk_live_x</secrets>."
    text, spans = parse(marked)
    assert text == "Hi Ana Lee, key sk_live_x."
    assert spans == [
        Span(3, 10, "customer-personal-data", "Ana Lee"),
        Span(16, 25, "secrets", "sk_live_x"),
    ]
    assert to_markup(make(text, spans)) == marked


def test_markup_ignores_other_tags_and_trims():
    text, spans = parse("<div>List<String></div> <secrets> abc </secrets>")
    assert text == "<div>List<String></div>  abc "
    assert spans == [Span(25, 28, "secrets", "abc")]


@pytest.mark.parametrize(
    "bad",
    [
        "<secrets>a <customer-names>b</customer-names></secrets>",
        "<secrets>unclosed",
        "stray </secrets>",
        "<secrets>  </secrets>",
    ],
)
def test_markup_errors(bad):
    with pytest.raises(MarkupError):
        parse(bad)
