# Evaluation: `tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-mh-test` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 205 of 29,018 records (sources macrohard-offline, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval tier2:ollama:gemma4:e4b-it-q4_K_M,base=results/preds/tier1-mh-test.jsonl --split test --source macrohard-offline --out-dir results/preds --save-predictions results/preds/t2-ollama-gemma4-e4b-it-q4_K_M-test.jsonl`
- **Date:** 2026-11-02 22:54 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- ⚠️ tier 2 (ollama:gemma4:e4b-it-q4_K_M): 109 calls, 425 spans judged, 39 cleared, 0 kept because the call failed
- ⚠️ tier 2 latency per call: p50 1031 ms, p95 2074 ms, max 2311 ms; mean output 98 tokens

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline |
| --- | ---: | ---: |
| Records | 205 | 205 |
| Gold spans | 999 | 999 |
| Predicted spans | 963 | 963 |
| **Red recall** (target ≥ 95%) | 91.5% ❌ | 91.5% ❌ |
| Red recall, any label | 93.1% | 93.1% |
| Micro precision | 94.8% | 94.8% |
| Micro recall | 90.9% | 90.9% |
| Micro F1 | 92.8% | 92.8% |
| **Safe text flagged** (FP rate) | 1.6% (1/61) | 1.6% (1/61) |
| **Hard negatives flagged** | 1.3% (1/79) | 1.3% (1/79) |
| Latency p50 (ms) | 485 | 485 |
| Latency p95 (ms) | 1961 | 1961 |
| Mean chars / record | 221 | 221 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 76 | 85.5% | 100.0% | 92.2% | 92.2% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 162 | 93.8% | 100.0% | 96.8% | 96.8% | – |
| `unreleased-roadmap` | red | 157 | 139 | 98.6% | 87.3% | 92.6% | 92.6% | 0.0% (0/50) |
| `secrets` | red | 49 | 29 | 100.0% | 59.2% | 74.4% | 61.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 391 | 386 | 99.7% | 97.2% | 98.4% | 90.3% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 76 | 85.5% | 100.0% | 92.2% | 92.2% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 162 | 93.8% | 100.0% | 96.8% | 96.8% | – |
| `unreleased-roadmap` | red | 157 | 139 | 98.6% | 87.3% | 92.6% | 92.6% | 0.0% (0/50) |
| `secrets` | red | 49 | 29 | 100.0% | 59.2% | 74.4% | 61.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 391 | 386 | 99.7% | 97.2% | 98.4% | 90.3% | 16.7% (1/6) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
