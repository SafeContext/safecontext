# Evaluation: `predictions-tier1-before-78-llm` on `llm-test`

- **Data:** `llm-test.jsonl`, sha256 `b76f9971fd004c03…`; 99 of 99 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-before-78-llm.jsonl --split llm-test`
- **Date:** 2026-11-04 03:29 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** as recorded by the classifier (not measured here)
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-llm |
| --- | ---: | ---: |
| Records | 99 | 99 |
| Gold spans | 624 | 624 |
| Predicted spans | 963 | 963 |
| **Red recall** (target ≥ 95%) | 69.1% ❌ | 69.1% ❌ |
| Red recall, any label | 69.9% | 69.9% |
| Micro precision | 46.4% | 46.4% |
| Micro recall | 71.6% | 71.6% |
| Micro F1 | 56.3% | 56.3% |
| **Safe text flagged** (FP rate) | 83.0% (39/47) | 83.0% (39/47) |
| **Hard negatives flagged** | 83.0% (39/47) | 83.0% (39/47) |
| Latency p50 (ms) | 106 | 106 |
| Latency p95 (ms) | 283 | 283 |
| Mean chars / record | 1,345 | 1,345 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 41 | 85.4% | 76.1% | 80.5% | 80.5% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 79 | 93.7% | 67.3% | 78.3% | 78.3% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 30 | 100.0% | 41.7% | 58.8% | 58.8% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 114 | 99.1% | 99.1% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 44 | 86.4% | 33.6% | 48.4% | 48.4% | 0.0% (0/47) |
| `secrets` | red | 58 | 51 | 90.2% | 79.3% | 84.4% | 66.1% | 4.3% (2/47) |
| `customer-personal-data` | red | 111 | 604 | 18.4% | 100.0% | 31.0% | 29.7% | 80.9% (38/47) |

## Per label: macrohard-llm

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 41 | 85.4% | 76.1% | 80.5% | 80.5% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 79 | 93.7% | 67.3% | 78.3% | 78.3% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 30 | 100.0% | 41.7% | 58.8% | 58.8% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 114 | 99.1% | 99.1% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 44 | 86.4% | 33.6% | 48.4% | 48.4% | 0.0% (0/47) |
| `secrets` | red | 58 | 51 | 90.2% | 79.3% | 84.4% | 66.1% | 4.3% (2/47) |
| `customer-personal-data` | red | 111 | 604 | 18.4% | 100.0% | 31.0% | 29.7% | 80.9% (38/47) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
