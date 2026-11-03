"""Tier 2: a small local LLM for context judgement and generalize (SPEC.md §4, issue #14).

- `prompts`: loads `ml/prompts/tier2/` (the files the agent loads too), builds requests,
  checks answers
- `client`: OpenAI-compatible chat client for Ollama and mlx_lm.server
- `calls`: one text's context judgement / generalize calls, with excerpts and failure handling
- `numbers`: number parsing, the leak and "still true" checks, the deterministic rewrite
- `generalize_eval`, `bench`: `python -m safecontext_ml.tier2 generalize|bench`

The context judgement is scored by the harness: `python -m safecontext_ml.eval tier2:...`
(`eval/adapters/tier2.py`). Results: `ml/results/tier2-llm.md`.
"""
