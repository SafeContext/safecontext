# Evaluation: `predictions-gliner-medium-v2.1-fine-t0.55` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-medium-v2.1-fine-t0.55.jsonl --split test`
- **Date:** 2026-10-28 04:01 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 112,494 | 1,001 | 77,972 | 20,119 | 13,402 |
| **Red recall** (target ≥ 95%) | 75.8% ❌ | 76.9% ❌ | 77.0% ❌ | 71.0% ❌ | 75.5% ❌ |
| Red recall, any label | 76.9% | 78.2% | 78.0% | 72.9% | 76.6% |
| Micro precision | 70.4% | 67.3% | 72.6% | 75.8% | 49.8% |
| Micro recall | 75.7% | 65.2% | 77.0% | 71.0% | 75.5% |
| Micro F1 | 73.0% | 66.2% | 74.8% | 73.3% | 60.0% |
| **Safe text flagged** (FP rate) | 44.6% (692/1,553) | 78.7% (48/61) | 26.2% (157/599) | 38.9% (63/162) | 58.0% (424/731) |
| **Hard negatives flagged** | 72.2% (57/79) | 72.2% (57/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.01 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 14,051 | 0 | 11,585 | 1,682 | 784 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 3,079 | 2.0% | 96.8% | 3.9% | 3.9% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 2,975 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 2,901 | 0.7% | 15.6% | 1.3% | 1.3% | – |
| `customer-names` | yellow | 152 | 2,027 | 5.5% | 73.7% | 10.3% | 10.3% | – |
| `unreleased-roadmap` | red | 157 | 1,500 | 8.6% | 82.2% | 15.6% | 15.6% | 82.0% (41/50) |
| `secrets` | red | 4,284 | 6,751 | 36.0% | 55.9% | 43.8% | 36.6% | 64.0% (16/25) |
| `customer-personal-data` | red | 108,095 | 93,261 | 82.0% | 76.5% | 79.2% | 56.1% | 0.0% (0/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 184 | 33.2% | 96.8% | 49.4% | 49.4% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 32 | 59.4% | 15.6% | 24.7% | 24.7% | – |
| `customer-names` | yellow | 152 | 145 | 77.2% | 73.7% | 75.4% | 75.4% | – |
| `unreleased-roadmap` | red | 157 | 233 | 55.4% | 82.2% | 66.2% | 66.2% | 82.0% (41/50) |
| `secrets` | red | 49 | 51 | 29.4% | 30.6% | 30.0% | 26.0% | 64.0% (16/25) |
| `customer-personal-data` | red | 391 | 356 | 94.9% | 80.6% | 87.2% | 57.6% | 0.0% (0/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1,867 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 2,716 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 1,718 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,112 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 698 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 6,114 | 37.7% | 58.2% | 45.8% | 38.2% | – |
| `customer-personal-data` | red | 78,611 | 63,747 | 85.2% | 77.9% | 81.4% | 58.3% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 141 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 58 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 490 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 185 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 397 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 323 | 17.6% | 39.0% | 24.3% | 21.7% | – |
| `customer-personal-data` | red | 21,164 | 18,525 | 82.1% | 71.2% | 76.3% | 51.8% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 887 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 201 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 661 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 585 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 172 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 263 | 18.6% | 26.9% | 22.0% | 18.0% | – |
| `customer-personal-data` | red | 7,929 | 10,633 | 62.2% | 76.6% | 68.7% | 48.6% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
