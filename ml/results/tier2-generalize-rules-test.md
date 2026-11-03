# Generalize: `rules` on `test`

- **Command:** `uv run python -m safecontext_ml.tier2 generalize rules --split test --out-dir results/preds`
- **Date:** 2026-11-02 23:33 UTC
- **Values:** 250 gold spans in 83 Macrohard records; one call per record
- **Checks:** `ml/src/safecontext_ml/tier2/generalize_eval.py` (no Claude). *True* is over the values whose rewrite the heuristic could check.

| Data type | Values | Answered | Format ok | Leak | Too precise | Entity leak | Checkable | True (of checkable) | **Clean** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 250 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | **100.0%** |
| `revenue-figures` | 63 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | **100.0%** |
| `internal-metrics` | 65 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | **100.0%** |
| `deal-sizes` | 122 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% | 100.0% | **100.0%** |
