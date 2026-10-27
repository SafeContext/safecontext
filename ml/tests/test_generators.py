import json
import random
from collections import Counter

import pytest

from safecontext_ml.dataset import llm, offline, public
from safecontext_ml.dataset.banks import BANKS, bank_for_split
from safecontext_ml.dataset.build import FrozenTestError, build
from safecontext_ml.dataset.labels import SPAN_LABELS
from safecontext_ml.dataset.render import SLOT_RE, render
from safecontext_ml.dataset.schema import (
    Record,
    Span,
    read_jsonl,
    validate,
    write_jsonl,
)
from safecontext_ml.dataset.split import assign_split
from safecontext_ml.dataset.values import CODENAME_WORDS, SLOT_KINDS, card, luhn_valid


@pytest.fixture(scope="module")
def offline_records() -> list[Record]:
    return list(offline.generate(60, seed=0))


def test_all_bank_slots_exist_and_banks_have_dev_and_test():
    for name, bank in BANKS.items():
        assert len(bank) >= 18, name
        assert bank_for_split(name, "dev") and bank_for_split(name, "test")
        for snip in bank:
            for m in SLOT_RE.finditer(snip.text):
                assert m.group(1) in SLOT_KINDS, (name, snip.text)


def test_render_offsets_and_shared_values():
    text, spans = render(
        "{{customer}} and {{customer}} vs {{customer#2}}", random.Random(0), "train"
    )
    first, second, third = (s.text for s in spans)
    assert first == second != third
    for s in spans:
        assert text[s.start : s.end] == s.text and s.label == "customer-names"


def test_cards_pass_luhn():
    rng = random.Random(1)
    assert all(luhn_valid(card(rng, "train")) for _ in range(200))


def test_offline_is_valid_and_deterministic(offline_records):
    assert all(validate(r) == [] for r in offline_records)
    again = list(offline.generate(60, seed=0))
    assert [r.to_json() for r in again] == [r.to_json() for r in offline_records]


def test_offline_covers_every_label_in_every_split(offline_records):
    for split in ("train", "dev", "test"):
        labels = Counter(
            s.label
            for r in offline_records
            if assign_split(r.group) == split
            for s in r.spans
        )
        assert set(labels) == set(SPAN_LABELS), (split, labels)
    assert any(r.hard_negative for r in offline_records)


def test_offline_test_entities_never_in_train(offline_records):
    def names(split: str) -> set[str]:
        # Customer names and codenames (dates can repeat across splits; names must not).
        return {
            s.text.removeprefix("Project ")
            for r in offline_records
            if assign_split(r.group) == split
            for s in r.spans
            if s.label == "customer-names"
            or (
                s.label == "unreleased-roadmap" and s.text.split()[-1] in CODENAME_WORDS
            )
        }

    assert names("test") and not names("test") & names("train")


# --- LLM backend (no network) ---


def test_llm_plan_is_deterministic_and_dry_run_sends_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "LLM_CACHE_DIR", tmp_path)
    monkeypatch.setattr(llm, "_call", lambda _p: pytest.fail("must not call the API"))
    a, b = llm.plan(3), llm.plan(3)
    assert [s.user_prompt() for s in a] == [s.user_prompt() for s in b]
    assert list(llm.run(1, dry_run=True)) == []


def _scenario(hard_negative: bool, values: dict[str, list[str]]) -> llm.Scenario:
    return llm.Scenario(
        "mh-llm-x-00000", llm.GENRES[0], "train", hard_negative, values, "short"
    )


def _cached(text: str, stop: str = "end_turn") -> dict:
    return {
        "params": {"model": "m"},
        "served_by": "m",
        "stop_reason": stop,
        "text": text,
    }


def test_llm_to_record_quality_gates():
    s = _scenario(False, {"customer-names": ["Bluefin Bank"]})
    rec, why = llm.to_record(
        s, _cached("<customer-names>Bluefin Bank</customer-names> renewed.")
    )
    assert rec and rec.spans[0].text == "Bluefin Bank" and not why
    assert llm.to_record(s, _cached("Bluefin Bank renewed."))[1].startswith("untagged")
    assert llm.to_record(s, _cached("x", stop="refusal"))[1].startswith("stop_reason")
    neg = _scenario(True, {})
    rec, _ = llm.to_record(neg, _cached("We shipped Macrohard Ledger."))
    assert rec and set(rec.negative_for) == set(SPAN_LABELS)
    assert (
        llm.to_record(neg, _cached("<secrets>abc</secrets>"))[1]
        == "hard negative contains tags"
    )


# --- public converters ---


def test_public_build_record_maps_ignores_and_drops_overlaps():
    from collections import Counter as C

    text = "Ana Lee, ana@x.com, Paris, 2024-01-02"
    unmapped: C[str] = C()
    rec = public.build_record(
        "src",
        "u1",
        text,
        [
            (0, 3, "first_name"),
            (0, 7, "name"),
            (9, 18, "email"),
            (20, 25, "city"),
            (27, 37, "weird"),
        ],
        {},
        unmapped,
    )
    assert rec is not None
    assert [(s.text, s.label) for s in rec.spans] == [
        ("Ana Lee", "customer-personal-data"),
        ("ana@x.com", "customer-personal-data"),
    ]
    assert [(s.text, s.label) for s in rec.ignore] == [
        ("Paris", "city"),
        ("2024-01-02", "weird"),
    ]
    assert unmapped == {"weird": 1}


def test_find_whole_skips_partial_words():
    assert list(public.find_whole("John Johnson met John.", "John")) == [0, 17]


# --- build ---


def _rec(i: int, text: str, group: str) -> Record:
    return Record(f"r{i}", text, [Span(0, 3, "secrets", text[:3])], "t", group, "g")


def _group_in(split: str) -> str:
    return next(f"grp{i}" for i in range(1000) if assign_split(f"grp{i}") == split)


def test_build_dedupes_across_splits_and_freezes_test(tmp_path):
    src, out = tmp_path / "sources", tmp_path / "splits"
    test_g, train_g = _group_in("test"), _group_in("train")
    write_jsonl(
        src / "a.jsonl",
        [
            _rec(1, "abc same", test_g),
            _rec(2, "abc  SAME", train_g),
            _rec(3, "xyz other", train_g),
        ],
    )
    manifest = build(src, out)
    assert manifest["dropped_duplicate_texts"] == 1
    assert [r.id for r in read_jsonl(out / "test.jsonl")] == ["r1"]
    assert [r.id for r in read_jsonl(out / "train.jsonl")] == ["r3"]
    assert (
        json.loads((out / "manifest.json").read_text())["splits"]["test"]["records"]
        == 1
    )

    # Adding train data is fine; changing test is refused unless --refreeze.
    write_jsonl(src / "b.jsonl", [_rec(4, "new train", train_g)])
    build(src, out)
    write_jsonl(src / "c.jsonl", [_rec(5, "new test", test_g)])
    with pytest.raises(FrozenTestError):
        build(src, out)
    assert build(src, out, refreeze=True)["splits"]["test"]["records"] == 2


def test_build_rejects_invalid_and_duplicate_ids(tmp_path):
    src = tmp_path / "s"
    write_jsonl(src / "a.jsonl", [_rec(1, "abc", "g"), _rec(1, "abd", "g")])
    with pytest.raises(ValueError, match="duplicate ids"):
        build(src, tmp_path / "o")
    bad = Record("b", "abc", [Span(0, 3, "nope", "abc")], "t", "g", "g")
    write_jsonl(src / "a.jsonl", [bad])
    with pytest.raises(ValueError, match="invalid records"):
        build(src, tmp_path / "o")
