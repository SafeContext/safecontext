# Evaluation: `predictions-tier1-before-78-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `dfe667ab75ef91b0…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-before-78-t0.6.jsonl --split test`
- **Date:** 2026-11-04 03:29 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 77,479 | 849 | 55,148 | 17,154 | 4,328 |
| Predicted spans | 113,517 | 1,002 | 82,172 | 21,688 | 8,655 |
| **Red recall** (target ≥ 95%) | 97.9% ✅ | 90.6% ❌ | 98.7% ✅ | 98.4% ✅ | 87.3% ❌ |
| Red recall, any label | 98.0% | 92.8% | 98.8% | 98.4% | 87.5% |
| Micro precision | 66.8% | 76.5% | 66.2% | 77.7% | 43.6% |
| Micro recall | 97.9% | 90.3% | 98.7% | 98.4% | 87.3% |
| Micro F1 | 79.4% | 82.9% | 79.3% | 86.8% | 58.2% |
| **Safe text flagged** (FP rate) | 37.7% (889/2,355) | 23.0% (14/61) | 40.8% (408/999) | 44.1% (108/245) | 34.2% (359/1,050) |
| **Hard negatives flagged** | 34.2% (27/79) | 34.2% (27/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.01 | 0.01 | 0.00 | 0.00 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 2,471 | 0 | 1,458 | 822 | 191 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 93 | 66.7% | 98.4% | 79.5% | 79.5% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 97 | 67.0% | 100.0% | 80.2% | 80.2% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 99 | 83.8% | 68.0% | 75.1% | 75.1% | – |
| `customer-names` | yellow | 152 | 213 | 71.4% | 100.0% | 83.3% | 83.3% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 4,284 | 4,079 | 97.9% | 93.3% | 95.5% | 94.8% | 0.0% (0/25) |
| `customer-personal-data` | red | 72,636 | 108,762 | 65.6% | 98.2% | 78.6% | 77.4% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 80 | 81.2% | 100.0% | 89.7% | 89.7% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 162 | 93.8% | 100.0% | 96.8% | 96.8% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 49 | 29 | 100.0% | 59.2% | 74.4% | 61.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 241 | 386 | 61.9% | 99.2% | 76.2% | 68.6% | 16.7% (1/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 8 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 2 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 23 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 3,730 | 99.1% | 94.7% | 96.9% | 96.4% | – |
| `customer-personal-data` | red | 51,241 | 78,409 | 64.7% | 99.0% | 78.2% | 77.2% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 10 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 15 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 162 | 84.6% | 94.5% | 89.3% | 86.4% | – |
| `customer-personal-data` | red | 17,008 | 21,498 | 77.8% | 98.4% | 86.9% | 85.9% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 13 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 158 | 81.6% | 70.9% | 75.9% | 74.1% | – |
| `customer-personal-data` | red | 4,146 | 8,469 | 43.1% | 88.0% | 57.8% | 54.0% | – |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
