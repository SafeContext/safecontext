# ml/ (Python)

Rules for `ml/`. The repo-wide rules are in the root `AGENTS.md`.

- `uv run ...` inside `ml/`. Add deps with `uv add`. The lock is limited to Apple Silicon macOS.
- Never commit weights, datasets or exports (`ml/models/`, `ml/data/raw/`, `*.onnx`, etc. are gitignored).
  They live in the private Hugging Face org `SafeContext` (#70); `pnpm models:pull` fetches them.
- Paid API spend for #14 is capped at $5 in total; run judge or data jobs through `claude -p`, and
  only after Joe OKs the run (see #14).
