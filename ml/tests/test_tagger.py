"""Tier 1 tagger plumbing (issue #13). No torch or gliner needed: the model is faked."""

import itertools
import json

import pytest

from safecontext_ml.dataset import SPAN_LABELS
from safecontext_ml.dataset.schema import Record, Span
from safecontext_ml.eval.adapters.gliner import default_name, parse
from safecontext_ml.tagger import NAMES, PROMPT_SETS, GlinerTagger, TaggerConfig
from safecontext_ml.tagger import chunking as C
from safecontext_ml.tagger.finetune import to_examples
from safecontext_ml.tagger.prompts import one_per_type
from safecontext_ml.tagger.sweep import filter_file


class FakeTokenizer:
    """One subword per 4 characters, like a crude BPE."""

    def __call__(self, x, add_special_tokens=False):
        one = isinstance(x, str)
        ids = [[0] * max(1, (len(w) + 3) // 4) for w in ([x] if one else x)]
        return {"input_ids": ids[0] if one else ids}


def test_one_per_type():
    assert one_per_type(PROMPT_SETS["names"]) == NAMES
    assert len(one_per_type(PROMPT_SETS["entity"])) == len(SPAN_LABELS)
    with pytest.raises(ValueError, match="several prompts"):
        one_per_type(PROMPT_SETS["fine"])


def test_prompt_sets_cover_every_span_label():
    for name, prompts in PROMPT_SETS.items():
        assert set(prompts.values()) == set(SPAN_LABELS), name
    assert NAMES["secrets"] == "api keys & secrets"
    assert NAMES["customer-personal-data"] == "customer personal data"


def test_words_match_gliner_splitter():
    text = "Ann's key: sk_live_ab-12 ok"
    assert [text[s:e] for s, e in C.words(text)] == [
        "Ann", "'", "s", "key", ":", "sk_live_ab-12", "ok",
    ]  # fmt: skip


def test_windows_fit_budget_and_overlap():
    offsets = [(i * 2, i * 2 + 1) for i in range(100)]
    ws = C.windows(offsets, [3] * 100, budget=30, max_words=384, overlap=4)
    assert all(w.last_word - w.first_word + 1 <= 10 for w in ws)
    assert ws[0].first_word == 0 and ws[-1].last_word == 99
    for a, b in itertools.pairwise(ws):
        assert b.first_word == a.last_word + 1 - 4  # 4 words of overlap
    # a word longer than the budget still gets a window
    assert C.windows([(0, 5)], [99], budget=10) == [C.Window(0, 5, 0, 0)]
    assert C.windows([], [], budget=10) == []


def test_merge_keeps_best_non_overlapping():
    spans = [
        C.Span(0, 5, "a", 0.6),
        C.Span(3, 8, "b", 0.9),
        C.Span(3, 8, "b", 0.9),  # duplicate from an overlapping window
        C.Span(10, 12, "a", 0.5),
    ]
    assert C.merge(spans) == [C.Span(3, 8, "b", 0.9), C.Span(10, 12, "a", 0.5)]


class FakeModel:
    """Returns every occurrence of 'KEY' as a secret, offsets relative to the window text."""

    def __init__(self):
        self.calls = []

    def inference(self, texts, labels, flat_ner, threshold, batch_size):
        self.calls.append(texts)
        out = []
        for t in texts:
            found, i = [], t.find("KEY")
            while i >= 0:
                found.append(
                    {"start": i, "end": i + 3, "label": "api key", "score": 0.9}
                )
                i = t.find("KEY", i + 1)
            out.append(found)
        return out


def test_tagger_chunks_and_maps_offsets_back():
    t = GlinerTagger(TaggerConfig(prompts="fine", overlap=2))
    t.model, t.tokenizer, t.budget, t.max_words = FakeModel(), FakeTokenizer(), 6, 384
    text = " ".join(["word"] * 10 + ["KEY"] + ["word"] * 10 + ["KEY"])
    spans = t.predict(text)
    assert len(t.model.calls[0]) > 1  # it was chunked
    assert [(text[s.start : s.end], s.label) for s in spans] == [
        ("KEY", "secrets"),
        ("KEY", "secrets"),
    ]
    assert t.predict_many(["", "   "]) == [[], []]


def test_adapter_spec_parsing(tmp_path):
    cfg, name = parse(
        "urchade/gliner_large-v2.1,threshold=0.3,device=mps,prompts=names"
    )
    assert (cfg.model, cfg.threshold, cfg.device, cfg.prompts) == (
        "urchade/gliner_large-v2.1", 0.3, "mps", "names",
    )  # fmt: skip
    assert name is None
    assert default_name(cfg) == "gliner-gliner_large-v2.1-names-t0.3"
    cfg, _ = parse(None)
    assert cfg.model == "urchade/gliner_small-v2.1"
    with pytest.raises(ValueError, match="unknown gliner option"):
        parse("m,colour=red")
    with pytest.raises(ValueError, match="unknown prompt set"):
        parse("m,prompts=nope")
    # an export directory's labels.json supplies the prompts
    (tmp_path / "labels.json").write_text(json.dumps({"secrets": "x"}))
    (tmp_path / "tier1.json").write_text(json.dumps({"threshold": 0.4}))
    cfg, _ = parse(f"{tmp_path},device=onnx")
    assert cfg.prompt_map == {"x": "secrets"} and cfg.prompts == "export"
    assert cfg.threshold == 0.4
    assert default_name(cfg).endswith("-export-t0.4-onnx")


def _record(text, spans, genre="slack-thread", ignore=()):
    def mk(sub, label):
        i = text.index(sub)
        return Span(i, i + len(sub), label, sub)

    return Record(
        id="r",
        text=text,
        spans=[mk(*s) for s in spans],
        source="macrohard-offline",
        group="r",
        genre=genre,
        ignore=[mk(*s) for s in ignore],
    )


def test_training_examples_word_spans_and_labels():
    r = _record(
        "Bluefin Logistics paid $4.2M via key sk_live_abc",
        [
            ("Bluefin Logistics", "customer-names"),
            ("$4.2M", "deal-sizes"),
            ("sk_live_abc", "secrets"),
        ],
    )
    (ex,) = to_examples(r, FakeTokenizer(), budget=100, max_width=12)
    words = ex["tokenized_text"]
    assert [(" ".join(words[a : b + 1]), lab) for a, b, lab in ex["ner"]] == [
        ("Bluefin Logistics", "customer names"),
        ("$ 4 . 2M", "deal sizes"),
        ("sk_live_abc", "api keys & secrets"),
    ]
    assert sorted(ex["ner_labels"]) == sorted(NAMES.values())


def test_training_windows_never_split_spans_and_truncate_long_ones():
    text = "a b c d e f g h i j k l m n o p"
    r = _record(text, [("c d e f", "secrets")])
    exs = to_examples(r, FakeTokenizer(), budget=4, max_width=2)
    found = [
        (" ".join(e["tokenized_text"][a : b + 1]), lab)
        for e in exs
        for a, b, lab in e["ner"]
    ]
    assert found == [("c d", "api keys & secrets")]  # truncated to max_width words
    assert sum(len(e["tokenized_text"]) for e in exs) == 16  # windows don't overlap


def test_public_company_ignore_drops_customer_names_prompt():
    r = _record(
        "Ann at Acme",
        [("Ann", "customer-personal-data")],
        genre="public-pii",
        ignore=[("Acme", "company")],
    )
    (ex,) = to_examples(r, FakeTokenizer(), budget=100, max_width=12)
    assert "customer names" not in ex["ner_labels"]
    assert "customer personal data" in ex["ner_labels"]


def test_sweep_filter_file(tmp_path):
    src = tmp_path / "p.jsonl"
    src.write_text(
        json.dumps({"id": "a", "spans": [{"start": 0, "end": 1, "label": "secrets", "score": 0.2},
                                         {"start": 2, "end": 3, "label": "secrets", "score": 0.7}]}) + "\n"
    )  # fmt: skip
    filter_file(src, tmp_path / "q.jsonl", 0.5)
    row = json.loads((tmp_path / "q.jsonl").read_text())
    assert [s["start"] for s in row["spans"]] == [2]
