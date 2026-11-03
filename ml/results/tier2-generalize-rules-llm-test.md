# Generalize: `rules` on `llm-test`

- **Command:** `uv run python -m safecontext_ml.tier2 generalize rules --split llm-test`
- **Date:** 2026-11-03 19:52 UTC
- **Values:** 228 gold spans in 42 Macrohard records; one call per record
- **Checks:** `ml/src/safecontext_ml/tier2/generalize_eval.py` (no Claude). *True* is over the values whose rewrite the heuristic could check.

| Data type | Values | Answered | Format ok | Leak | Too precise | Entity leak | Checkable | True (of checkable) | **Clean** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 228 | 96.5% | 96.5% | 0.0% | 0.0% | 0.0% | 96.5% | 100.0% | **96.5%** |
| `revenue-figures` | 46 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | **100.0%** |
| `internal-metrics` | 110 | 93.6% | 93.6% | 0.0% | 0.0% | 0.0% | 93.6% | 100.0% | **93.6%** |
| `deal-sizes` | 72 | 98.6% | 98.6% | 0.0% | 0.0% | 0.0% | 98.6% | 100.0% | **98.6%** |
