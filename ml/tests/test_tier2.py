import json
import math

import pytest

from safecontext_ml import claude_cli
from safecontext_ml.dataset.schema import Record, Span
from safecontext_ml.eval import judge as J
from safecontext_ml.eval.adapters import AdapterContext, load_classifier
from safecontext_ml.eval.classifier import Doc
from safecontext_ml.tier2 import calls
from safecontext_ml.tier2 import numbers as N
from safecontext_ml.tier2 import prompts as P
from safecontext_ml.tier2.client import ChatResult, Runtime, RuntimeCallError
from safecontext_ml.tier2.generalize_eval import (
    Item,
    apply_rewrites,
    check,
    check_format,
)

# --- prompt files ---


@pytest.mark.parametrize("task", P.TASKS)
def test_prompt_files_load_and_examples_match_schema(task):
    t = P.load_task(task)
    assert t.system and "{{document}}" in t.user_template
    turns = P.example_turns(t)
    assert len(turns) == 2 * len(t.examples)
    for ex in t.examples:
        ids = [s["id"] for s in ex["spans"]]
        # Each example's answer must pass the same checks as a model's answer.
        assert set(P.parse_answer(task, json.dumps(ex["output"]), ids)) == set(ids)


def test_manifest_has_what_the_agent_needs():
    m = P.manifest()
    assert m["version"] >= 1
    assert set(m["tasks"]) == set(P.TASKS)
    assert m["timeouts"]["per_call_ms"] < 8000  # inside the agent's default 8 s budget
    for t in m["tasks"].values():
        assert (P.PROMPTS_DIR / t["dir"] / "schema.json").exists()


def test_mark_and_render_user():
    text = "Project Heron launches March 3."
    spans = [
        P.SpanRef(0, 13, "unreleased-roadmap"),
        P.SpanRef(23, 30, "unreleased-roadmap"),
    ]
    req = P.build_request("context", text, spans, few_shot=False)
    user = req.messages[-1]["content"]
    assert "<s1>Project Heron</s1> launches <s2>March 3</s2>." in user
    assert '- s1: "Project Heron" (unreleased-roadmap)' in user
    assert "- unreleased-roadmap (Unreleased roadmap): Plans" in user
    assert user.count("- unreleased-roadmap") == 1
    assert req.ids == ["s1", "s2"]
    assert [m["role"] for m in req.messages] == ["system", "user"]
    with_shots = P.build_request("context", text, spans)
    assert len(with_shots.messages) == 2 + 2 * len(P.load_task("context").examples)


def test_mark_rejects_overlaps():
    with pytest.raises(ValueError):
        P.mark("abcdef", [P.SpanRef(0, 3, "x"), P.SpanRef(2, 4, "x")], "s")


def test_excerpts_cut_long_texts_around_spans():
    text = "a" * 100 + "SECRET" + "b" * 1000 + "OTHER" + "c" * 100
    s1 = P.SpanRef(100, 106, "x")
    s2 = P.SpanRef(1106, 1111, "x")
    assert P.excerpts(text, [s1, s2], 50, 5000) == [P.Excerpt(0, text, [s1, s2])]
    ex = P.excerpts(text, [s2, s1], 50, 500)
    assert [e.spans for e in ex] == [[s1], [s2]]
    for e in ex:
        for s in e.spans:
            assert (
                text[s.start : s.end] == e.text[s.start - e.offset : s.end - e.offset]
            )
    # Overlapping windows share an excerpt.
    assert len(P.excerpts(text, [s1, s2], 600, 500)) == 1


@pytest.mark.parametrize(
    "answer",
    [
        '{"spans": [{"id": "s1", "reason": "x", "sensitive": true}]}',
        '```json\n{"spans": [{"id": "s1", "reason": "x", "sensitive": true}]}\n```',
        'Here you go: {"spans": [{"id": "s1", "reason": "x", "sensitive": true}]} done',
    ],
)
def test_parse_answer_accepts_json_with_noise(answer):
    assert P.parse_answer("context", answer, ["s1"])["s1"]["sensitive"] is True


@pytest.mark.parametrize(
    "answer",
    [
        "not json",
        '{"spans": [{"id": "s1", "reason": "x"}]}',  # missing field
        '{"spans": [{"id": "s1", "reason": "x", "sensitive": "yes"}]}',  # wrong type
        '{"spans": [{"id": "s2", "reason": "x", "sensitive": true}]}',  # unknown id
        '{"spans": []}',  # missing id
        '{"spans": [{"id": "s1", "reason": "x", "sensitive": true}, {"id": "s1", "reason": "x", "sensitive": true}]}',
        '{"spans": [{"id": "s1", "reason": "x", "sensitive": true, "extra": 1}]}',
    ],
)
def test_parse_answer_rejects_bad_answers(answer):
    with pytest.raises(P.ResponseError):
        P.parse_answer("context", answer, ["s1"])


def test_generalize_answer_length_limit():
    long = json.dumps({"rewrites": [{"id": "g1", "text": "x" * 61}]})
    with pytest.raises(P.ResponseError):
        P.parse_answer("generalize", long, ["g1"])


# --- runtime request bodies ---


def test_runtime_bodies():
    schema = P.load_task("context").schema
    o = Runtime.parse("ollama:qwen3.5:4b-q4_K_M")
    assert (o.kind, o.model, o.base_url) == (
        "ollama",
        "qwen3.5:4b-q4_K_M",
        "http://127.0.0.1:11434/v1",
    )
    b = o.body([{"role": "user", "content": "hi"}], schema, 100)
    assert b["reasoning_effort"] == "none"
    assert b["response_format"]["json_schema"]["schema"] == schema
    assert b["temperature"] == 0
    m = Runtime.parse("mlx:mlx-community/Qwen3.5-4B-4bit")
    b = m.body([{"role": "user", "content": "hi"}], schema, 100)
    assert b["chat_template_kwargs"] == {"enable_thinking": False}
    assert "response_format" not in b
    with pytest.raises(ValueError):
        Runtime.parse("vllm:x")


class FakeRuntime(Runtime):
    def __init__(self, answers):
        super().__init__("ollama", "fake")
        self.answers = list(answers)
        self.sent = []

    def chat(self, messages, schema=None, max_tokens=512, timeout_s=30.0):
        self.sent.append(messages)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return ChatResult(
            text=a, elapsed_ms=5.0, completion_tokens=10, finish_reason="stop"
        )


def test_judge_context_maps_answers_and_failures():
    text = "Heron shipped. Quill is planned."
    s1, s2 = (
        P.SpanRef(0, 5, "unreleased-roadmap"),
        P.SpanRef(15, 20, "unreleased-roadmap"),
    )
    rt = FakeRuntime(
        [
            '{"spans": [{"id": "s1", "reason": "shipped", "sensitive": false}, {"id": "s2", "reason": "planned", "sensitive": true}]}'
        ]
    )
    log = calls.CallLog()
    assert calls.judge_context(rt, text, [s2, s1], log=log) == {s1: False, s2: True}
    assert len(log.calls) == 1 and not log.failures
    rt = FakeRuntime(["garbage"])
    assert calls.judge_context(rt, text, [s1, s2], log=log) == {s1: None, s2: None}
    rt = FakeRuntime([RuntimeCallError("down")])
    assert calls.judge_context(rt, text, [s1], log=log) == {s1: None}
    assert log.n_failed == 2


def test_tier2_adapter_drops_only_cleared_spans(tmp_path, monkeypatch):
    text = "Heron shipped. Quill is planned. jane@corp.com"
    preds = tmp_path / "base.jsonl"
    preds.write_text(
        json.dumps(
            {
                "id": "r1",
                "spans": [
                    {"start": 0, "end": 5, "label": "unreleased-roadmap"},
                    {"start": 15, "end": 20, "label": "unreleased-roadmap"},
                    {"start": 33, "end": 46, "label": "customer-personal-data"},
                ],
            }
        )
        + "\n"
    )
    clf = load_classifier(f"tier2:ollama:fake,base={preds}", AdapterContext([], {}))
    answer = '{"spans": [{"id": "s1", "reason": "shipped", "sensitive": false}, {"id": "s2", "reason": "planned", "sensitive": true}]}'
    monkeypatch.setattr(
        Runtime, "chat", lambda self, *a, **k: ChatResult(answer, 3.0, 1, 1, "stop")
    )
    out = clf.predict(Doc("r1", text))
    assert [(p.start, p.label) for p in out] == [
        (15, "unreleased-roadmap"),
        (33, "customer-personal-data"),
    ]
    assert clf.cleared == 1 and clf.judged == 2
    # A failed call keeps everything.
    monkeypatch.setattr(
        Runtime, "chat", lambda self, *a, **k: ChatResult("nope", 3.0, 1, 1, "stop")
    )
    assert len(clf.predict(Doc("r1", text))) == 3


# --- numbers: values, claims, leaks ---


@pytest.mark.parametrize(
    "text,value,kind,sig",
    [
        ("$4.2M", 4.2e6, "money", 2),
        ("18%", 18, "percent", 2),
        ("-3.2%", -3.2, "percent", 2),
        ("€34,679,000", 34_679_000, "money", 5),
        ("340 ms", 340, "duration_ms", 2),
        ("12,946", 12946, "count", 5),
        ("143.3k", 143_300, "count", 4),
        ("$0.2 million", 200_000, "money", 1),
        ("£33.5 million", 33.5e6, "money", 3),
    ],
)
def test_parse_value(text, value, kind, sig):
    v = N.parse_value(text)
    assert v is not None
    assert math.isclose(v.value, value) and v.kind == kind and v.sig == sig


@pytest.mark.parametrize(
    "rewrite,original,expected",
    [
        ("high teens", "18%", True),
        ("mid-teens", "18%", False),
        ("high teens", "29.6%", False),
        ("high twenties", "29.6%", True),
        ("under 1%", "0.8%", True),
        ("about $4M", "$4.2M", True),
        ("over $1M", "$1,474,000", True),
        ("low six figures", "$134k", True),
        ("low six figures", "$3.5M", False),
        ("a few million dollars", "$3.6M", True),
        ("tens of millions", "$48.1M", True),
        ("single digits", "6.4%", True),
        ("mid single digits", "6.4%", True),
        ("low single digits", "6.4%", False),
        ("over half", "62%", True),
        ("around a third", "30.7%", True),
        ("between $1M and $2M", "$1.5M", True),
        ("$1-2M", "$2.5M", False),
        ("a few hundred ms", "340 ms", True),
        ("nearly 1,000", "980", True),
        ("nearly 1,000", "1,200", False),
        ("strong growth", "18%", None),
    ],
)
def test_is_true(rewrite, original, expected):
    assert N.is_true(rewrite, N.parse_value(original)) is expected


@pytest.mark.parametrize(
    "rewrite,original,leak,precise",
    [
        ("about $4.2M", "$4.2M", True, False),
        ("4.2 million dollars", "$4.2M", True, False),
        ("about $4M", "$4.2M", False, False),
        ("about 70%", "70%", True, False),
        ("about 70%", "69%", False, False),
        ("about 13,000", "12,946", False, True),
        ("high teens", "18%", False, False),
    ],
)
def test_leak_and_precision(rewrite, original, leak, precise):
    v = N.parse_value(original)
    assert N.leaks_value(rewrite, v, original) is leak
    assert N.too_precise(rewrite, v) is precise or leak


@pytest.mark.parametrize(
    "span",
    [
        "$4.2M",
        "18%",
        "12,946",
        "$2M",
        "30%",
        "0.8%",
        "146.9k",
        "340 ms",
        "$1,474,000",
        "7%",
        "-3.2%",
        "99.95%",
        "£0.2 million",
    ],
)
def test_rule_rewrite_is_true_and_never_leaks(span):
    r = N.rule_rewrite(span)
    v = N.parse_value(span)
    assert r and N.is_true(r, v) is True
    assert not N.leaks_value(r, v, span) and not N.too_precise(r, v)
    assert check_format(r, span)


def test_rule_rewrite_skips_non_numbers():
    assert N.rule_rewrite("Project Heron") is None


# --- generalize checks ---


def test_check_flags_entity_leak_and_format():
    it = check(
        Item("r", "deal-sizes", "$134k", "Bluefin's six figures"),
        ["Bluefin Logistics", "Bluefin", "$134k"],
    )
    assert it.entity_leak and not it.clean
    it = check(
        Item("r", "deal-sizes", "$134k", "low six figures"), ["Bluefin", "$134k"]
    )
    assert it.clean and it.true is True
    assert not check_format("[deal size]", "$134k")
    assert not check_format("one two three four five six seven", "$134k")
    assert not check(Item("r", "deal-sizes", "$134k", None), []).clean


def test_apply_rewrites_uses_placeholders_for_other_spans():
    text = "Bluefin signed $134k."
    r = Record(
        "r",
        text,
        [Span(0, 7, "customer-names", "Bluefin"), Span(15, 20, "deal-sizes", "$134k")],
        "s",
        "r",
        "sales-notes",
    )
    assert (
        apply_rewrites(r, {(15, 20): "low six figures"})
        == "[customer-names 1] signed low six figures."
    )


# --- claude -p backend (no real calls) ---


def test_claude_cli_command_and_parse():
    params = J.judge_params(
        J.JudgeItem("r", "s", "g", "task", "orig", "clean"),
        "ref",
        "cand",
        "claude-sonnet-5-5",
    )
    cmd, stdin = claude_cli.command(params)
    assert cmd[:4] == ["claude", "-p", "--output-format", "json"]
    assert cmd[cmd.index("--model") + 1] == "claude-sonnet-5-5"
    assert cmd[cmd.index("--tools") + 1] == ""
    assert json.loads(cmd[cmd.index("--json-schema") + 1]) == J.JUDGE_SCHEMA
    assert cmd[cmd.index("--system-prompt") + 1] == J.JUDGE_SYSTEM
    assert "<candidate_answer>" in stdin
    out = claude_cli.parse_output(
        json.dumps(
            {
                "type": "result",
                "subtype": "success",
                "is_error": False,
                "result": "",
                "structured_output": {"reason": "ok", "score": 4, "preserved": True},
                "usage": {"input_tokens": 10, "output_tokens": 20},
                "modelUsage": {"claude-sonnet-5-5": {}},
                "total_cost_usd": 0.01,
            }
        ),
        params,
    )
    assert json.loads(out["text"])["score"] == 4
    assert out["stop_reason"] == "end_turn" and out["served_by"] == "claude-sonnet-5-5"
    with pytest.raises(claude_cli.ClaudeCliError):
        claude_cli.parse_output(
            '{"is_error": true, "subtype": "error_max_turns"}', params
        )
    with pytest.raises(ValueError):
        claude_cli.command({"model": "m", "messages": []})


def test_judge_claude_cli_dry_run_counts_and_never_calls(monkeypatch, tmp_path):
    monkeypatch.setattr(J, "JUDGE_CACHE_DIR", tmp_path)

    def boom(*a, **k):
        raise AssertionError("must not call claude without --yes")

    monkeypatch.setattr(J, "_call", boom)
    items = [J.JudgeItem(f"r{i}", "s", "g", "t", "orig", "clean") for i in range(5)]
    s = J.run(items, "claude-sonnet-5-5", yes=False, backend="claude-cli")
    assert s.uncached_requests == 15 and not s.sent and s.est_cost is None
    assert s.backend == "claude-cli"
    assert (
        J.cache_path({"model": "m"}, "claude-cli").parent
        == tmp_path / "claude-cli" / "m"
    )
    with pytest.raises(ValueError):
        J.run(items, backend="nope")
