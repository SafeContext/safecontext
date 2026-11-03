"""Send a Messages-API-style request through the local Claude Code CLI (`claude -p`).

The `claude-cli` backend for the judge (`eval --judge-backend claude-cli`) and the synthetic
data generator (`dataset llm --backend claude-cli`). It runs on the user's own Claude Code
login (subscription), so there is **no API spend and no API key**: the child process gets the
environment without `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, so it can only use the CLI's
own login. It still uses the subscription's limits, so callers keep their `--yes` gate.

A request dict (`model`, `system`, one user message, `output_config.effort`,
`output_config.format.schema`) becomes:

    claude -p --output-format json --model MODEL --system-prompt SYSTEM [--effort E]
           [--json-schema SCHEMA] --tools "" --strict-mcp-config --no-session-persistence

with the user message on stdin, run from an empty temporary directory (no CLAUDE.md, no
project settings). `max_tokens` has no CLI flag and is ignored. The answer is returned in the
same shape as the API backends' cached responses (`text`, `stop_reason`, `usage`...), so the
caches and parsers don't change.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from typing import Any

#: Environment variables that would make the CLI bill an API key instead of the login.
_STRIPPED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
TIMEOUT_S = 600


class ClaudeCliError(RuntimeError):
    pass


def command(
    params: dict[str, Any], executable: str = "claude"
) -> tuple[list[str], str]:
    """The argv and stdin for a request. Pure, for tests and dry runs."""
    msgs = params.get("messages") or []
    if (
        len(msgs) != 1
        or msgs[0].get("role") != "user"
        or not isinstance(msgs[0].get("content"), str)
    ):
        raise ValueError(
            "claude-cli backend supports exactly one user message with string content"
        )
    cfg = params.get("output_config") or {}
    cmd = [
        executable,
        "-p",
        "--output-format",
        "json",
        "--model",
        params["model"],
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]
    if params.get("system"):
        cmd += ["--system-prompt", params["system"]]
    if cfg.get("effort"):
        cmd += ["--effort", cfg["effort"]]
    schema = (cfg.get("format") or {}).get("schema")
    if schema is not None:
        cmd += ["--json-schema", json.dumps(schema, separators=(",", ":"))]
    return cmd, msgs[0]["content"]


def parse_output(stdout: str, params: dict[str, Any]) -> dict[str, Any]:
    """`claude -p --output-format json` stdout -> the cached-response shape."""
    try:
        out = json.loads(stdout)
    except ValueError as e:
        raise ClaudeCliError(f"claude -p printed no JSON: {stdout[:200]!r}") from e
    if out.get("is_error") or out.get("subtype") not in (None, "success"):
        raise ClaudeCliError(
            f"claude -p failed: {out.get('subtype')}: {str(out.get('result'))[:200]}"
        )
    has_schema = bool(
        ((params.get("output_config") or {}).get("format") or {}).get("schema")
    )
    if has_schema and out.get("structured_output") is not None:
        text = json.dumps(out["structured_output"], ensure_ascii=False)
    else:
        text = out.get("result") or ""
    usage = out.get("usage") or {}
    served = list((out.get("modelUsage") or {}).keys())
    return {
        "params": params,
        "backend": "claude-cli",
        "served_by": served[0] if len(served) == 1 else (served or params["model"]),
        "stop_reason": "end_turn",
        "text": text,
        "usage": {
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        },
        # What the same tokens would cost on the API. Informational: the CLI bills the login.
        "notional_cost_usd": out.get("total_cost_usd"),
    }


def call(
    params: dict[str, Any],
) -> dict[str, Any]:  # pragma: no cover - runs the real CLI
    exe = shutil.which("claude")
    if exe is None:
        raise ClaudeCliError("`claude` (Claude Code CLI) is not on PATH")
    cmd, stdin = command(params, exe)
    env = {k: v for k, v in os.environ.items() if k not in _STRIPPED_ENV}
    with tempfile.TemporaryDirectory(prefix="sc-claude-cli-") as cwd:
        proc = subprocess.run(
            cmd,
            input=stdin,
            capture_output=True,
            text=True,
            env=env,
            cwd=cwd,
            timeout=TIMEOUT_S,
            check=False,
        )
    if proc.returncode != 0 and not proc.stdout.strip():
        raise ClaudeCliError(f"claude -p exited {proc.returncode}: {proc.stderr[:300]}")
    return parse_output(proc.stdout, params)
