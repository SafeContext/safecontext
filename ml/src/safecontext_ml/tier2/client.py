"""A minimal OpenAI-compatible chat client for local runtimes (Ollama, mlx_lm.server).

Both runtimes serve `POST {base_url}/chat/completions` with the OpenAI request and response
shape, so the agent can swap one for the other by changing the base URL and model name. They
differ in two request fields, which `Runtime.body` adds:

| Runtime | Structured output | Turning thinking off (Qwen3.5 and other hybrid models) |
| --- | --- | --- |
| Ollama (`ollama serve`, default `http://127.0.0.1:11434/v1`) | `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`: decoding is constrained to the schema | `reasoning_effort: "none"` |
| mlx_lm.server (`mlx_lm.server --model REPO`, default `http://127.0.0.1:8080/v1`) | not supported (ignored): the prompt asks for JSON and the answer is checked | `chat_template_kwargs: {enable_thinking: false}` |

Uses only the standard library, so the tests and the harness need nothing extra.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

DEFAULT_URLS = {
    "ollama": "http://127.0.0.1:11434/v1",
    "mlx": "http://127.0.0.1:8080/v1",
}


class RuntimeCallError(RuntimeError):
    """The runtime couldn't be reached or returned an error."""


@dataclass
class ChatResult:
    text: str
    elapsed_ms: float
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    finish_reason: str | None = None


@dataclass
class Runtime:
    """Where and how to call a model. `kind` is `ollama` or `mlx`."""

    kind: str
    model: str
    base_url: str = ""
    #: Extra request fields (merged last), e.g. {"top_p": 1}.
    extra: dict[str, Any] = field(default_factory=dict)
    structured_output: bool | None = None

    def __post_init__(self) -> None:
        if self.kind not in DEFAULT_URLS:
            raise ValueError(
                f"runtime must be one of {sorted(DEFAULT_URLS)}, not {self.kind!r}"
            )
        self.base_url = (self.base_url or DEFAULT_URLS[self.kind]).rstrip("/")
        if self.structured_output is None:
            self.structured_output = self.kind == "ollama"

    @classmethod
    def parse(cls, spec: str, **kw: Any) -> Runtime:
        """`ollama:qwen3.5:4b-q4_K_M` or `mlx:mlx-community/Qwen3.5-4B-4bit`."""
        kind, _, model = spec.partition(":")
        if not model:
            raise ValueError(f"runtime spec must be RUNTIME:MODEL, not {spec!r}")
        return cls(kind, model, **kw)

    @property
    def label(self) -> str:
        return f"{self.kind}:{self.model}"

    def body(
        self,
        messages: list[dict[str, str]],
        schema: dict[str, Any] | None,
        max_tokens: int,
        temperature: float = 0.0,
        seed: int | None = 0,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if seed is not None:
            body["seed"] = seed
        if self.kind == "ollama":
            body["reasoning_effort"] = "none"
        else:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if schema is not None and self.structured_output:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.get("title", "answer"),
                    "schema": schema,
                    "strict": True,
                },
            }
        body.update(self.extra)
        return body

    def chat(
        self,
        messages: list[dict[str, str]],
        schema: dict[str, Any] | None = None,
        max_tokens: int = 512,
        timeout_s: float = 30.0,
    ) -> ChatResult:
        data = json.dumps(self.body(messages, schema, max_tokens)).encode()
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise RuntimeCallError(
                f"{self.label}: HTTP {e.code}: {e.read()[:300]!r}"
            ) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeCallError(f"{self.label}: {e}") from e
        elapsed = (time.perf_counter() - t0) * 1000
        choice = payload["choices"][0]
        usage = payload.get("usage") or {}
        return ChatResult(
            text=choice["message"].get("content") or "",
            elapsed_ms=elapsed,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            finish_reason=choice.get("finish_reason"),
        )
