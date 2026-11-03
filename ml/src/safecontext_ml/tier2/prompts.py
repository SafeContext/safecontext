"""Load the tier 2 prompt files and build chat requests from them (issue #14).

The prompts live in `ml/prompts/tier2/<task>/` so the agent (#16) loads the same files:

- `system.md`: the system prompt
- `user.md`: the user message template, with `{{data_types}}`, `{{document}}` and `{{spans}}`
- `schema.json`: JSON Schema of the model's answer (sent as structured output where the
  runtime supports it, and always checked on the way back)
- `examples.json`: few-shot examples, rendered with `user.md` and sent as earlier
  user/assistant turns

`tier2.json` next to them holds the prompt version, request settings and timeouts.
Rendering is plain string substitution, so the TypeScript port is a few lines; see
`render_user` for the exact line formats.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from ..dataset.paths import ML_ROOT

PROMPTS_DIR = ML_ROOT / "prompts" / "tier2"
TASKS = ("context", "generalize")
#: Marker prefix per task: <s1>...</s1> for spans to judge, <g1>...</g1> for values to rewrite.
PREFIX = {"context": "s", "generalize": "g"}
#: The array in each task's answer, and the field that carries the result.
ANSWER_ARRAY = {"context": "spans", "generalize": "rewrites"}


@dataclass(frozen=True)
class DataTypeInfo:
    id: str
    name: str
    description: str


@dataclass(frozen=True)
class SpanRef:
    """A span to send: offsets into the full text and its data type id."""

    start: int
    end: int
    data_type: str


@dataclass(frozen=True)
class Task:
    name: str
    system: str
    user_template: str
    schema: dict[str, Any]
    examples: list[dict[str, Any]]
    example_types: dict[str, DataTypeInfo]

    @property
    def prefix(self) -> str:
        return PREFIX[self.name]


def manifest(prompts_dir: Path = PROMPTS_DIR) -> dict[str, Any]:
    return json.loads((prompts_dir / "tier2.json").read_text(encoding="utf-8"))


@cache
def load_task(name: str, prompts_dir: Path = PROMPTS_DIR) -> Task:
    if name not in TASKS:
        raise ValueError(f"unknown tier 2 task {name!r}; known: {', '.join(TASKS)}")
    d = prompts_dir / name
    ex = json.loads((d / "examples.json").read_text(encoding="utf-8"))
    return Task(
        name=name,
        system=(d / "system.md").read_text(encoding="utf-8").strip(),
        user_template=(d / "user.md").read_text(encoding="utf-8").strip(),
        schema=json.loads((d / "schema.json").read_text(encoding="utf-8")),
        examples=ex["examples"],
        example_types={
            k: DataTypeInfo(k, v["name"], v["description"])
            for k, v in ex["data_types"].items()
        },
    )


def default_data_types() -> dict[str, DataTypeInfo]:
    """Names and descriptions of the default data types (`packages/policy` defaults)."""
    from ..dataset import labels as L

    return {t.id: DataTypeInfo(t.id, t.name, t.description) for t in L.DATA_TYPES}


def mark(text: str, spans: Sequence[SpanRef], prefix: str, offset: int = 0) -> str:
    """`text` with `<{prefix}N>...</{prefix}N>` around each span, numbered 1.. in order.

    `spans` must be sorted and must not overlap. `offset` is where `text` starts in the full
    text the span offsets refer to (for excerpts)."""
    out, pos = [], 0
    for i, s in enumerate(spans, 1):
        a, b = s.start - offset, s.end - offset
        if a < pos or b > len(text) or a >= b:
            raise ValueError(f"span {s} overlaps another or is outside the text")
        out += [text[pos:a], f"<{prefix}{i}>", text[a:b], f"</{prefix}{i}>"]
        pos = b
    out.append(text[pos:])
    return "".join(out)


def render_user(
    task: Task,
    marked_document: str,
    spans: Sequence[tuple[str, str, str]],
    data_types: Mapping[str, DataTypeInfo],
) -> str:
    """The user message. `spans` = (id, span text, data type id), in document order.

    Line formats (the agent must produce the same):
    - data types: `- <id> (<name>): <description>`, one per data type used by the spans, in
      order of first use
    - spans: `- <id>: "<span text>" (<data type id>)`, with `"` and newlines in the span text
      escaped as in JSON
    """
    used: list[str] = []
    for _, _, dt in spans:
        if dt not in used:
            used.append(dt)
    type_lines = []
    for dt in used:
        info = data_types.get(dt) or DataTypeInfo(dt, dt, "")
        type_lines.append(f"- {info.id} ({info.name}): {info.description}".rstrip(": "))
    span_lines = [
        f"- {sid}: {json.dumps(t, ensure_ascii=False)} ({dt})" for sid, t, dt in spans
    ]
    values = {
        "data_types": "\n".join(type_lines),
        "document": marked_document,
        "spans": "\n".join(span_lines),
    }
    # One pass, so a document that itself contains "{{spans}}" is left as it is.
    return _PLACEHOLDER.sub(lambda m: values[m[1]], task.user_template)


_PLACEHOLDER = re.compile(r"\{\{(data_types|document|spans)\}\}")


_EXAMPLE_SPAN = re.compile(r"<([sg]\d+)>(.*?)</\1>", re.DOTALL)


def example_turns(task: Task) -> list[dict[str, str]]:
    turns = []
    for ex in task.examples:
        found = dict(_EXAMPLE_SPAN.findall(ex["document"]))
        spans = []
        for s in ex["spans"]:
            if found.get(s["id"]) != s["text"]:
                raise ValueError(
                    f"{task.name} example: span {s['id']} doesn't match its marker"
                )
            spans.append((s["id"], s["text"], s["data_type"]))
        user = render_user(task, ex["document"], spans, task.example_types)
        turns.append({"role": "user", "content": user})
        turns.append(
            {
                "role": "assistant",
                "content": json.dumps(ex["output"], ensure_ascii=False),
            }
        )
    return turns


@dataclass(frozen=True)
class Request:
    """One tier 2 call: the chat messages plus what is needed to read the answer."""

    task: str
    messages: list[dict[str, str]]
    ids: list[str]
    #: ids -> span refs in the full text
    spans: dict[str, SpanRef]


def build_request(
    task_name: str,
    text: str,
    spans: Sequence[SpanRef],
    data_types: Mapping[str, DataTypeInfo] | None = None,
    offset: int = 0,
    few_shot: bool = True,
) -> Request:
    """Build the chat messages for `spans` in `text` (an excerpt starting at `offset`)."""
    task = load_task(task_name)
    data_types = data_types or default_data_types()
    spans = sorted(spans, key=lambda s: s.start)
    ids = [f"{task.prefix}{i}" for i in range(1, len(spans) + 1)]
    marked = mark(text, spans, task.prefix, offset)
    span_rows = [
        (sid, text[s.start - offset : s.end - offset], s.data_type)
        for sid, s in zip(ids, spans, strict=True)
    ]
    messages = [{"role": "system", "content": task.system}]
    if few_shot:
        messages += example_turns(task)
    messages.append(
        {"role": "user", "content": render_user(task, marked, span_rows, data_types)}
    )
    return Request(task_name, messages, ids, dict(zip(ids, spans, strict=True)))


# --- excerpts for long texts ---


@dataclass(frozen=True)
class Excerpt:
    offset: int
    text: str
    spans: list[SpanRef]


def excerpts(
    text: str, spans: Sequence[SpanRef], context_chars: int, max_chars: int
) -> list[Excerpt]:
    """Cut a long text into excerpts around the spans, one tier 2 call each.

    The whole text is one excerpt if it fits in `max_chars`. Otherwise each span gets
    `context_chars` of text on each side, and spans whose windows overlap share an excerpt.
    Cut edges are left as they are (no ellipsis), so offsets stay simple."""
    spans = sorted(spans, key=lambda s: s.start)
    if not spans:
        return []
    if len(text) <= max_chars:
        return [Excerpt(0, text, list(spans))]
    groups: list[tuple[int, int, list[SpanRef]]] = []
    for s in spans:
        a, b = max(0, s.start - context_chars), min(len(text), s.end + context_chars)
        if groups and a <= groups[-1][1]:
            ga, gb, gs = groups[-1]
            groups[-1] = (ga, max(gb, b), [*gs, s])
        else:
            groups.append((a, b, [s]))
    return [Excerpt(a, text[a:b], g) for a, b, g in groups]


# --- reading answers ---


class ResponseError(ValueError):
    """The model's answer isn't valid JSON for the task's schema."""


def extract_json(text: str) -> Any:
    """Parse the answer: plain JSON, or JSON inside a ``` fence or surrounded by other text
    (runtimes without structured output, such as mlx_lm.server)."""
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", s)
    try:
        return json.loads(s)
    except ValueError:
        pass
    a, b = s.find("{"), s.rfind("}")
    if a != -1 and b > a:
        try:
            return json.loads(s[a : b + 1])
        except ValueError:
            pass
    raise ResponseError("answer is not JSON")


def validate(obj: Any, schema: Mapping[str, Any], path: str = "$") -> None:
    """A small JSON Schema subset (type, properties, required, additionalProperties, items,
    pattern, minLength, maxLength, enum): enough for the tier 2 schemas, no dependency."""
    t = schema.get("type")
    types = {
        "object": dict,
        "array": list,
        "string": str,
        "boolean": bool,
        "integer": int,
        "number": (int, float),
    }
    if (
        t
        and not isinstance(obj, types[t])
        or (t in ("integer", "number") and isinstance(obj, bool))
    ):
        raise ResponseError(f"{path}: expected {t}")
    if "enum" in schema and obj not in schema["enum"]:
        raise ResponseError(f"{path}: not one of {schema['enum']}")
    if t == "object":
        props = schema.get("properties", {})
        for k in schema.get("required", []):
            if k not in obj:
                raise ResponseError(f"{path}: missing {k!r}")
        if schema.get("additionalProperties") is False:
            extra = set(obj) - set(props)
            if extra:
                raise ResponseError(f"{path}: unexpected {sorted(extra)}")
        for k, v in obj.items():
            if k in props:
                validate(v, props[k], f"{path}.{k}")
    elif t == "array" and "items" in schema:
        for i, v in enumerate(obj):
            validate(v, schema["items"], f"{path}[{i}]")
    elif t == "string":
        if len(obj) < schema.get("minLength", 0):
            raise ResponseError(f"{path}: too short")
        if "maxLength" in schema and len(obj) > schema["maxLength"]:
            raise ResponseError(f"{path}: too long")
        if "pattern" in schema and not re.search(schema["pattern"], obj):
            raise ResponseError(f"{path}: doesn't match {schema['pattern']}")


def parse_answer(
    task_name: str, text: str, ids: Sequence[str]
) -> dict[str, dict[str, Any]]:
    """Parse and check an answer. Returns {id: entry} with exactly the requested ids.

    Raises `ResponseError` when the JSON is invalid, an id is missing, unknown or repeated.
    The caller decides what a failure means (the agent: keep the span flagged / fall back)."""
    task = load_task(task_name)
    obj = extract_json(text)
    validate(obj, task.schema)
    out: dict[str, dict[str, Any]] = {}
    for entry in obj[ANSWER_ARRAY[task_name]]:
        sid = entry["id"]
        if sid not in ids:
            raise ResponseError(f"unknown id {sid!r}")
        if sid in out:
            raise ResponseError(f"repeated id {sid!r}")
        out[sid] = entry
    missing = [i for i in ids if i not in out]
    if missing:
        raise ResponseError(f"missing ids {missing}")
    return out
