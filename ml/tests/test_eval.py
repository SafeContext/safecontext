import json

import pytest

from safecontext_ml.dataset.schema import Record, Span, write_jsonl
from safecontext_ml.eval import judge as J
from safecontext_ml.eval.__main__ import main
from safecontext_ml.eval.adapters import AdapterContext, load_classifier
from safecontext_ml.eval.adapters.predictions_file import utf16_to_codepoint
from safecontext_ml.eval.adapters.regex_baseline import RegexBaseline
from safecontext_ml.eval.classifier import Doc, Prediction
from safecontext_ml.eval.metrics import Scorer, percentile, score_record


def rec(text, spans=(), *, id="r1", source="s", negative_for=(), ignore=(), genre="x"):
    def mk(s):
        start = text.index(s[0])
        return Span(start, start + len(s[0]), s[1], s[0])

    return Record(
        id=id,
        text=text,
        spans=[mk(s) for s in spans],
        source=source,
        group=id,
        genre=genre,
        negative_for=list(negative_for),
        ignore=[mk(s) for s in ignore],
    )


def P(text, sub, label, extra=0):
    start = text.index(sub)
    return Prediction(start, start + len(sub) + extra, label)


# --- matching rules ---


def test_overlap_and_exact_matching():
    text = "Mail jane@corp.io or call Bluefin Logistics"
    r = rec(
        text,
        [
            ("jane@corp.io", "customer-personal-data"),
            ("Bluefin Logistics", "customer-names"),
        ],
    )
    preds = [
        P(text, "jane@corp.io", "customer-personal-data"),  # exact
        P(text, "Bluefin", "customer-names"),  # partial overlap
        P(text, "call", "deal-sizes"),  # false positive
    ]
    res = score_record(r, preds)
    pd, cn, ds = (
        res.labels[k]
        for k in ("customer-personal-data", "customer-names", "deal-sizes")
    )
    assert (pd.gold_found, pd.pred_correct, pd.exact_tp) == (1, 1, 1)
    assert (cn.gold_found, cn.pred_correct, cn.exact_tp) == (1, 1, 0)
    assert (ds.pred, ds.pred_correct) == (1, 0)
    assert cn.recall == 1.0 and cn.exact_f1 == 0.0


def test_wrong_label_counts_only_for_red_recall_any_label():
    text = "key sk_live_abcdefghijklmnop"
    r = rec(text, [("sk_live_abcdefghijklmnop", "secrets")])
    s = Scorer()
    s.add(r, [P(text, "sk_live_abcdefghijklmnop", "customer-personal-data")], None)
    assert s.overall.red_recall == 0.0
    assert s.overall.red_recall_any == 1.0


def test_ignore_regions_drop_predictions_unless_they_hit_gold():
    text = "Ann lives in Paris"
    r = rec(text, [("Ann", "customer-personal-data")], ignore=[("Paris", "city")])
    only_ignore = P(text, "Paris", "customer-personal-data")
    spanning = Prediction(0, len(text), "customer-personal-data")
    res = score_record(r, [only_ignore])
    assert res.dropped_ignore == 1 and res.labels["customer-personal-data"].pred == 0
    res = score_record(r, [spanning])
    assert (
        res.dropped_ignore == 0 and res.labels["customer-personal-data"].gold_found == 1
    )


def test_invalid_and_duplicate_predictions():
    r = rec("abc")
    res = score_record(
        r,
        [
            Prediction(2, 9, "secrets"),
            Prediction(1, 1, "secrets"),
            Prediction(0, 1, "public-docs"),
            Prediction(0, 1, "secrets"),
            Prediction(0, 1, "secrets"),
        ],
    )
    assert res.dropped_invalid == 3
    assert res.labels["secrets"].pred == 1


def test_safe_and_hard_negative_false_positive_rates():
    s = Scorer()
    t1 = "Project Heron shipped last year"
    s.add(
        rec(t1, id="a", negative_for=["unreleased-roadmap"]),
        [P(t1, "Heron", "unreleased-roadmap")],
        1.0,
    )
    t2 = "Public docs page"
    s.add(
        rec(t2, id="b", negative_for=["unreleased-roadmap"]),
        [P(t2, "docs", "secrets")],
        2.0,
    )
    s.add(rec("Nothing here", id="c"), [], 3.0)
    g = s.overall
    assert (g.safe_records, g.safe_flagged) == (3, 2)
    assert (g.hn_records, g.hn_flagged) == (2, 1)
    assert g.labels["unreleased-roadmap"].hn_records == 2
    assert g.labels["unreleased-roadmap"].hn_flagged == 1
    assert g.latency(50) == 2.0


def test_per_source_groups():
    s = Scorer()
    s.add(rec("a b", id="1", source="macrohard-offline"), [], None)
    s.add(rec("c d", id="2", source="nemotron-pii"), [], None)
    s.add(rec("e f", id="3", source="nemotron-pii"), [], None)
    assert s.sources() == ["macrohard-offline", "nemotron-pii"]
    assert s.groups["nemotron-pii"].records == 2 and s.overall.records == 3


def test_percentile_nearest_rank():
    assert percentile([], 50) is None
    assert percentile([5.0], 95) == 5.0
    assert percentile(list(range(1, 101)), 95) == 95
    assert percentile(list(range(1, 101)), 50) == 50


# --- adapters ---


def test_regex_baseline():
    c = RegexBaseline()

    def labels(text):
        return [(text[p.start : p.end], p.label) for p in c.predict(Doc("x", text))]

    assert labels("mail ann@corp.io now") == [("ann@corp.io", "customer-personal-data")]
    assert labels("see docs@example.com") == []
    assert labels("AWS AKIAABCDEFGHIJKLMNOP done") == [
        ("AKIAABCDEFGHIJKLMNOP", "secrets")
    ]
    assert labels("card 4111 1111 1111 1111") == [
        ("4111 1111 1111 1111", "customer-personal-data")
    ]
    assert labels("card 4111 1111 1111 1112") == []  # fails Luhn
    assert labels('password = "hunter2hunter"') == [("hunter2hunter", "secrets")]
    url = "postgres://svc:pa55word@db.internal:5432/core"
    assert labels(f'connect("{url}")') == [(url, "secrets")]


def test_gold_oracle_and_none():
    r = rec("Ann paid", [("Ann", "customer-personal-data")])
    ctx = AdapterContext([r])
    assert load_classifier("gold", ctx).predict(Doc(r.id, r.text)) == [
        Prediction(0, 3, "customer-personal-data")
    ]
    assert load_classifier("none", ctx).predict(Doc(r.id, r.text)) == []
    with pytest.raises(ValueError, match="unknown model"):
        load_classifier("nope", ctx)
    with pytest.raises(NotImplementedError, match="#13"):
        load_classifier("gliner", ctx)


def test_utf16_offsets():
    text = "🙂 ann@corp.io"  # the emoji is 2 UTF-16 units, 1 code point
    assert utf16_to_codepoint(text, 3) == 2
    assert utf16_to_codepoint(text, 14) == len(text)
    assert utf16_to_codepoint("plain", 3) == 3


def test_predictions_file(tmp_path):
    text = "🙂 ann@corp.io"
    r = rec(text, [("ann@corp.io", "customer-personal-data")])
    f = tmp_path / "tier0.jsonl"
    f.write_text(
        json.dumps(
            {
                "id": "r1",
                "latency_ms": 1.5,
                "spans": [
                    {"start": 3, "end": 14, "dataTypeId": "customer-personal-data"},
                    {"start": 0, "end": 2, "label": "custom-admin-type"},
                ],
            }
        )
        + "\n"
    )
    ctx = AdapterContext([r], {"pred_offsets": "utf16"})
    clf = load_classifier(f"predictions:{f}", ctx)
    assert clf.reports_own_latency and clf.latency_ms(Doc("r1", text)) == 1.5
    assert clf.predict(Doc("r1", text)) == [Prediction(2, 13, "customer-personal-data")]
    assert clf.unknown_labels == {"custom-admin-type": 1}
    with pytest.raises(KeyError, match="--allow-missing"):
        clf.predict(Doc("other", "x"))


# --- end to end ---


@pytest.fixture
def splits(tmp_path):
    t1 = "Contact ann@corp.io about Bluefin Logistics"
    t2 = "key AKIAABCDEFGHIJKLMNOP and phone"
    records = [
        rec(
            t1,
            [
                ("ann@corp.io", "customer-personal-data"),
                ("Bluefin Logistics", "customer-names"),
            ],
            id="m1",
            source="macrohard-offline",
            genre="sales-notes",
        ),
        rec(
            "Press release: Heron is out",
            id="m2",
            source="macrohard-offline",
            negative_for=["unreleased-roadmap"],
            genre="press-release",
        ),
        rec(
            t2,
            [("AKIAABCDEFGHIJKLMNOP", "secrets")],
            id="p1",
            source="nemotron-pii",
            genre="public-pii",
        ),
    ]
    d = tmp_path / "splits"
    write_jsonl(d / "test.jsonl", records)
    return d


def test_cli_end_to_end_and_predictions_round_trip(splits, tmp_path, capsys):
    out = tmp_path / "results"
    preds = tmp_path / "preds.jsonl"
    main(
        [
            "regex",
            "--splits-dir",
            str(splits),
            "--out-dir",
            str(out),
            "--save-predictions",
            str(preds),
        ]
    )
    report = capsys.readouterr().out
    assert "# Evaluation: `regex` on `test`" in report
    assert "## Per label: macrohard-offline" in report
    assert "Task preservation" in report and "Not run" in report
    data = json.loads((out / "regex-test.json").read_text())
    assert data["groups"]["overall"]["records"] == 3
    assert data["groups"]["overall"]["red_recall"] == 1.0
    assert data["groups"]["overall"]["labels"]["customer-names"]["recall"] == 0.0

    main([f"predictions:{preds}", "--splits-dir", str(splits), "--out-dir", str(out)])
    again = json.loads((out / "predictions-preds-test.json").read_text())
    for k in ("red_recall", "micro", "safe_fp_rate", "labels"):
        assert again["groups"]["overall"][k] == data["groups"]["overall"][k]


def test_cli_sampling_and_write_inputs(splits, tmp_path, capsys):
    inputs = tmp_path / "in.jsonl"
    main(
        [
            "--splits-dir",
            str(splits),
            "--source",
            "macrohard-offline",
            "--write-inputs",
            str(inputs),
        ]
    )
    rows = [json.loads(line) for line in inputs.read_text().splitlines()]
    assert [r["id"] for r in rows] == ["m1", "m2"] and set(rows[0]) == {"id", "text"}
    main(["none", "--splits-dir", str(splits), "--limit", "1", "--no-save"])
    assert "1 of 3 records (random 1, seed 0)" in capsys.readouterr().out


# --- judge (API always mocked) ---


def test_clean_text_placeholders():
    text = "Ann emailed Ann about Bluefin and Corvid"
    preds = [
        P(text, "Ann", "customer-personal-data"),
        Prediction(12, 15, "customer-personal-data"),
        P(text, "Bluefin", "customer-names"),
        P(text, "Corvid", "customer-names"),
        P(text, "Corv", "customer-names"),
    ]  # overlapping: merged
    assert J.clean_text(text, preds) == (
        "[customer-personal-data 1] emailed [customer-personal-data 1] about "
        "[customer-names 1] and [customer-names 2]"
    )


@pytest.fixture
def judge_env(tmp_path, monkeypatch):
    monkeypatch.setattr(J, "JUDGE_CACHE_DIR", tmp_path / "judge-cache")
    calls = []

    def fake_call(params):
        calls.append(params)
        if "format" in params["output_config"]:
            text = json.dumps({"reason": "fine", "score": 4, "preserved": True})
        else:
            text = "answer: " + params["messages"][0]["content"][-20:]
        return {
            "params": params,
            "served_by": params["model"],
            "stop_reason": "end_turn",
            "text": text,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(J, "_call", fake_call)
    return calls


def _items():
    recs = [
        rec(
            f"Ann {i} paid",
            [("Ann", "customer-personal-data")],
            id=f"r{i}",
            source=f"s{i % 2}",
        )
        for i in range(4)
    ]
    preds = {r.id: [Prediction(0, 3, "customer-personal-data")] for r in recs}
    preds["r3"] = []  # unchanged text: never judged
    return J.select(recs, preds, n=10)


def test_judge_select_round_robin():
    items = _items()
    assert sorted(i.record_id for i in items) == ["r0", "r1", "r2"]
    assert {items[0].source, items[1].source} == {"s0", "s1"}
    assert items[0].cleaned.startswith("[customer-personal-data 1]")


def test_judge_without_yes_sends_nothing(judge_env, capsys):
    summary = J.run(_items(), yes=False)
    assert judge_env == []
    assert summary.uncached_requests == 9 and summary.est_cost > 0 and not summary.sent
    assert summary.scored == [] and "Re-run with --yes" in capsys.readouterr().err


def test_judge_with_yes_then_cache(judge_env):
    summary = J.run(_items(), yes=True)
    assert len(judge_env) == 9
    assert summary.mean_score() == 4.0 and summary.preserved_rate() == 1.0
    judge_env.clear()
    again = J.run(_items(), yes=False)  # all cached: free, scored
    assert judge_env == [] and again.uncached_requests == 0 and len(again.scored) == 3


def test_judge_params_use_structured_output():
    item = _items()[0]
    p = J.judge_params(item, "ref", "cand", J.DEFAULT_MODEL)
    assert p["output_config"]["format"]["schema"] == J.JUDGE_SCHEMA
    assert J.DEFAULT_MODEL in J.PRICES


def test_cli_judge_estimate_only(splits, tmp_path, judge_env, capsys):
    main(["regex", "--splits-dir", str(splits), "--no-save", "--judge", "5"])
    out = capsys.readouterr()
    assert judge_env == []
    assert "**Not sent:**" in out.out and "uncached requests" in out.err
