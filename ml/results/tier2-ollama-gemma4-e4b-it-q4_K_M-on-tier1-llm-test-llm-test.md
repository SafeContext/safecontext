# Evaluation: `tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-llm-test` on `llm-test`

- **Data:** `llm-test.jsonl`, sha256 `f525da3f4b92dc49…`; 99 of 99 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval tier2:ollama:gemma4:e4b-it-q4_K_M,base=results/preds/tier1-llm-test.jsonl --split llm-test --save-predictions results/preds/tier2-llm-test.jsonl`
- **Date:** 2026-11-03 19:51 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- ⚠️ tier 2 (ollama:gemma4:e4b-it-q4_K_M): 42 calls, 194 spans judged, 7 cleared, 0 kept because the call failed
- ⚠️ tier 2 latency per call: p50 1277 ms, p95 2450 ms, max 2755 ms; mean output 115 tokens

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-llm |
| --- | ---: | ---: |
| Records | 99 | 99 |
| Gold spans | 670 | 670 |
| Predicted spans | 956 | 956 |
| **Red recall** (target ≥ 95%) | 73.2% ❌ | 73.2% ❌ |
| Red recall, any label | 73.8% | 73.8% |
| Micro precision | 51.6% | 51.6% |
| Micro recall | 73.4% | 73.4% |
| Micro F1 | 60.6% | 60.6% |
| **Safe text flagged** (FP rate) | 83.0% (39/47) | 83.0% (39/47) |
| **Hard negatives flagged** | 83.0% (39/47) | 83.0% (39/47) |
| Latency p50 (ms) | 0.02 | 0.02 |
| Latency p95 (ms) | 2292 | 2292 |
| Mean chars / record | 1,345 | 1,345 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 41 | 85.4% | 76.1% | 80.5% | 80.5% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 77 | 96.1% | 67.3% | 79.1% | 79.1% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 30 | 100.0% | 41.7% | 58.8% | 58.8% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 114 | 99.1% | 99.1% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 39 | 97.4% | 33.6% | 50.0% | 50.0% | 0.0% (0/47) |
| `secrets` | red | 58 | 51 | 90.2% | 79.3% | 84.4% | 66.1% | 4.3% (2/47) |
| `customer-personal-data` | red | 157 | 604 | 26.0% | 99.4% | 41.2% | 39.4% | 80.9% (38/47) |

## Per label: macrohard-llm

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 41 | 85.4% | 76.1% | 80.5% | 80.5% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 77 | 96.1% | 67.3% | 79.1% | 79.1% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 30 | 100.0% | 41.7% | 58.8% | 58.8% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 114 | 99.1% | 99.1% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 39 | 97.4% | 33.6% | 50.0% | 50.0% | 0.0% (0/47) |
| `secrets` | red | 58 | 51 | 90.2% | 79.3% | 84.4% | 66.1% | 4.3% (2/47) |
| `customer-personal-data` | red | 157 | 604 | 26.0% | 99.4% | 41.2% | 39.4% | 80.9% (38/47) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
