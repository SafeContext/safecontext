# Generalize: `ollama:gemma4:e4b-it-q4_K_M` on `test`

- **Command:** `uv run python -m safecontext_ml.tier2 generalize ollama:gemma4:e4b-it-q4_K_M --split test --out-dir results/preds`
- **Date:** 2026-11-02 22:55 UTC
- **Values:** 250 gold spans in 83 Macrohard records; one call per record
- **Checks:** `ml/src/safecontext_ml/tier2/generalize_eval.py` (no Claude). *True* is over the values whose rewrite the heuristic could check.
- **Latency per call:** p50 818 ms, p95 973 ms (83 calls)

| Data type | Values | Answered | Format ok | Leak | Too precise | Entity leak | Checkable | True (of checkable) | **Clean** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 250 | 100.0% | 100.0% | 0.4% | 12.4% | 0.0% | 98.0% | 89.8% | **77.2%** |
| `revenue-figures` | 63 | 100.0% | 100.0% | 0.0% | 7.9% | 0.0% | 100.0% | 93.7% | **85.7%** |
| `internal-metrics` | 65 | 100.0% | 100.0% | 0.0% | 30.8% | 0.0% | 93.8% | 78.7% | **49.2%** |
| `deal-sizes` | 122 | 100.0% | 100.0% | 0.8% | 4.9% | 0.0% | 99.2% | 93.4% | **87.7%** |
