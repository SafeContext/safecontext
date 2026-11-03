# Generalize: `ollama:gemma4:e4b-it-q4_K_M` on `llm-test`

- **Command:** `uv run python -m safecontext_ml.tier2 generalize ollama:gemma4:e4b-it-q4_K_M --split llm-test`
- **Date:** 2026-11-03 19:53 UTC
- **Values:** 228 gold spans in 42 Macrohard records; one call per record
- **Checks:** `ml/src/safecontext_ml/tier2/generalize_eval.py` (no Claude). *True* is over the values whose rewrite the heuristic could check.
- **Latency per call:** p50 1168 ms, p95 2236 ms (42 calls)

| Data type | Values | Answered | Format ok | Leak | Too precise | Entity leak | Checkable | True (of checkable) | **Clean** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 228 | 100.0% | 100.0% | 1.3% | 8.3% | 0.0% | 91.2% | 89.9% | **81.1%** |
| `revenue-figures` | 46 | 100.0% | 100.0% | 2.2% | 13.0% | 0.0% | 100.0% | 100.0% | **84.8%** |
| `internal-metrics` | 110 | 100.0% | 100.0% | 1.8% | 3.6% | 0.0% | 82.7% | 84.6% | **81.8%** |
| `deal-sizes` | 72 | 100.0% | 100.0% | 0.0% | 12.5% | 0.0% | 98.6% | 90.1% | **77.8%** |
