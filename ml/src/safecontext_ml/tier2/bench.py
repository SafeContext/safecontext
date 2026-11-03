"""Speed and memory of one model on one runtime, as the agent would call it (issue #14).

    python -m safecontext_ml.tier2 bench ollama:qwen3.5:4b-q4_K_M
    python -m safecontext_ml.tier2 bench mlx:mlx-community/Qwen3.5-4B-4bit

- **Cold start**: from "model not in memory" to the first answer. Ollama: the server is
  already running (as the agent's launchd service would be); the model is unloaded first
  (`keep_alive: 0`), so this is load + first call. MLX: `mlx_lm.server` is started by this
  command, so it is process start + load + first call. Weights are probably in the OS file
  cache (we can't drop it without root), so a first start after a reboot is slower.
- **Latency**: p50/p95 wall-clock per call, one call at a time, over the same fixed requests
  for every model: context judgement calls (Macrohard dev records, their roadmap / revenue /
  metrics / deal spans) and generalize calls (their revenue / metrics / deal spans).
- **Peak RAM**: the highest resident set size (RSS) of the model process while the calls run,
  sampled every 0.2 s (Ollama: the `llama-server` runner started with this model's weights;
  MLX: the server). RSS counts the
  memory-mapped weights; Ollama's own figure (`/api/ps` size) is reported next to it.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Self

from ..dataset import labels as L
from ..dataset.paths import SPLITS_DIR
from ..dataset.schema import read_jsonl
from ..eval.metrics import percentile
from .calls import CallLog, generalize, judge_context
from .client import Runtime
from .prompts import SpanRef, manifest

CONTEXT_LABELS = tuple(manifest()["tasks"]["context"]["labels"])
GENERALIZE_LABELS = (L.REVENUE, L.METRICS, L.DEAL)


def _rss_kb(match: str) -> tuple[int, int] | None:
    """(pid, rss KB) of the largest process whose command line contains `match`."""
    out = subprocess.run(
        ["ps", "-axo", "pid=,rss=,command="],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    best = None
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3 and match in parts[2] and "ps -axo" not in parts[2]:
            pid, rss = int(parts[0]), int(parts[1])
            if best is None or rss > best[1]:
                best = (pid, rss)
    return best


class PeakRss:
    def __init__(self, match: str, every_s: float = 0.2) -> None:
        self.match, self.every = match, every_s
        self.peak_kb = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._loop, daemon=True)

    def _loop(self) -> None:
        while not self._stop.is_set():
            got = _rss_kb(self.match)
            if got:
                self.peak_kb = max(self.peak_kb, got[1])
            self._stop.wait(self.every)

    def __enter__(self) -> Self:
        self._t.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._t.join()


@dataclass
class BenchResult:
    runtime: str
    cold_start_ms: float | None = None
    context_ms: list[float] = field(default_factory=list)
    generalize_ms: list[float] = field(default_factory=list)
    context_tokens_out: list[int] = field(default_factory=list)
    peak_rss_mb: float | None = None
    ollama_size_mb: float | None = None
    #: Ollama only, from its native API (`/api/chat` timings) on 5 context calls after the run:
    #: mean prompt tokens actually evaluated (the shared prefix is cached), prefill tok/s,
    #: generated tokens, decode tok/s. Used for the base-Mac estimate.
    ollama_timings: dict[str, float] | None = None
    failures: dict[str, int] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        def stats(xs: list[float]) -> dict[str, Any]:
            return {"n": len(xs), "p50": percentile(xs, 50), "p95": percentile(xs, 95)}

        return {
            "runtime": self.runtime,
            "cold_start_ms": self.cold_start_ms,
            "context": stats(self.context_ms),
            "generalize": stats(self.generalize_ms),
            "context_mean_output_tokens": (
                sum(self.context_tokens_out) / len(self.context_tokens_out)
                if self.context_tokens_out
                else None
            ),
            "peak_rss_mb": self.peak_rss_mb,
            "ollama_size_mb": self.ollama_size_mb,
            "ollama_timings": self.ollama_timings,
            "failures": self.failures,
        }


def workload(
    n: int, split: str = "dev"
) -> tuple[list[tuple[str, list[SpanRef]]], list[tuple[str, list[SpanRef]]]]:
    """Fixed requests: the first n Macrohard records with context spans, and with generalize spans."""
    ctx, gen = [], []
    for r in read_jsonl(SPLITS_DIR / f"{split}.jsonl"):
        if not r.source.startswith("macrohard"):
            continue
        c = [
            SpanRef(s.start, s.end, s.label)
            for s in r.spans
            if s.label in CONTEXT_LABELS
        ]
        g = [
            SpanRef(s.start, s.end, s.label)
            for s in r.spans
            if s.label in GENERALIZE_LABELS
        ]
        if c and len(ctx) < n:
            ctx.append((r.text, c))
        if g and len(gen) < n:
            gen.append((r.text, g))
        if len(ctx) >= n and len(gen) >= n:
            break
    return ctx, gen


def _ollama_native(
    rt: Runtime, path: str, body: dict[str, Any] | None = None
) -> dict[str, Any]:
    base = rt.base_url.removesuffix("/v1")
    req = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read() or b"{}")


def _ollama_timings(
    rt: Runtime, requests: list[tuple[str, list[SpanRef]]]
) -> dict[str, float]:
    from .prompts import build_request, load_task

    rows = []
    for text, spans in requests:
        req = build_request("context", text, spans)
        r = _ollama_native(
            rt,
            "/api/chat",
            {
                "model": rt.model,
                "messages": req.messages,
                "stream": False,
                "think": False,
                "format": load_task("context").schema,
                "options": {"temperature": 0, "seed": 0},
            },
        )
        rows.append(r)

    def mean(key: str) -> float:
        return sum(r.get(key, 0) for r in rows) / len(rows)

    return {
        "prompt_tokens_evaluated": mean("prompt_eval_count"),
        "prefill_tok_s": sum(r.get("prompt_eval_count", 0) for r in rows)
        / max(1e-9, sum(r.get("prompt_eval_duration", 0) for r in rows) / 1e9),
        "generated_tokens": mean("eval_count"),
        "decode_tok_s": sum(r.get("eval_count", 0) for r in rows)
        / max(1e-9, sum(r.get("eval_duration", 0) for r in rows) / 1e9),
    }


def _wait_ready(rt: Runtime, timeout_s: float = 600) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            urllib.request.urlopen(rt.base_url + "/models", timeout=2).read()
            return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError("runtime did not come up")


def bench(spec: str, n: int = 40, url: str = "", split: str = "dev") -> BenchResult:
    rt = Runtime.parse(spec, base_url=url)
    res = BenchResult(rt.label)
    ctx, gen = workload(n, split)
    log = CallLog()
    first_text, first_spans = ctx[0]
    server: subprocess.Popen[bytes] | None = None
    try:
        if rt.kind == "ollama":
            _ollama_native(rt, "/api/generate", {"model": rt.model, "keep_alive": 0})
            for _ in range(100):
                if not any(
                    m["name"] == rt.model
                    for m in _ollama_native(rt, "/api/ps").get("models", [])
                ):
                    break
                time.sleep(0.2)
            t0 = time.perf_counter()
            judge_context(rt, first_text, first_spans, log=log, timeout_s=600)
            res.cold_start_ms = (time.perf_counter() - t0) * 1000
            # The runner for this model: llama-server started with this model's weights blob.
            show = _ollama_native(rt, "/api/show", {"model": rt.model})
            blob = next(
                line.split(None, 1)[1]
                for line in show.get("modelfile", "").splitlines()
                if line.startswith("FROM ")
            )
            match = f"--model {blob}"
        else:
            port = rt.base_url.rsplit(":", 1)[1].split("/")[0]
            t0 = time.perf_counter()
            server = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "mlx_lm.server",
                    "--model",
                    rt.model,
                    "--port",
                    port,
                    "--chat-template-args",
                    '{"enable_thinking":false}',
                    "--log-level",
                    "WARNING",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            _wait_ready(rt)
            judge_context(rt, first_text, first_spans, log=log, timeout_s=600)
            res.cold_start_ms = (time.perf_counter() - t0) * 1000
            match = "mlx_lm.server"
        log = CallLog()
        with PeakRss(match) as peak:
            for text, spans in ctx:
                judge_context(rt, text, spans, log=log)
            n_ctx = len(log.calls)
            for text, spans in gen:
                generalize(rt, text, spans, log=log)
        res.context_ms = [c.elapsed_ms for c in log.calls[:n_ctx]]
        res.context_tokens_out = [c.completion_tokens or 0 for c in log.calls[:n_ctx]]
        res.generalize_ms = [c.elapsed_ms for c in log.calls[n_ctx:]]
        res.failures = log.failures
        res.peak_rss_mb = peak.peak_kb / 1024 if peak.peak_kb else None
        if rt.kind == "ollama":
            for m in _ollama_native(rt, "/api/ps").get("models", []):
                if m["name"] == rt.model:
                    res.ollama_size_mb = m["size"] / 2**20
            res.ollama_timings = _ollama_timings(rt, ctx[1:6])
    finally:
        if server is not None:
            server.send_signal(signal.SIGTERM)
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                server.kill()
        elif rt.kind == "ollama":
            # Free the memory for the next candidate.
            _ollama_native(rt, "/api/generate", {"model": rt.model, "keep_alive": 0})
    return res


def main_bench(specs: list[str], n: int, url: str, out: str | None) -> None:
    results = []
    for spec in specs:
        print(f"bench {spec} ...", file=sys.stderr)
        r = bench(spec, n, url)
        results.append(r.to_json())
        print(json.dumps(r.to_json()), flush=True)
    if out:
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        with open(out, "a", encoding="utf-8") as f:
            for r in results:
                f.write(json.dumps(r) + "\n")
