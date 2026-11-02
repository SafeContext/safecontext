# Evaluation: `predictions-gliner-pii-base-v1.0-fine-t0.45` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-pii-base-v1.0-fine-t0.45.jsonl --split test`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 84,108 | 1,078 | 58,352 | 15,201 | 9,477 |
| **Red recall** (target ≥ 95%) | 69.0% ❌ | 83.6% ❌ | 70.0% ❌ | 66.4% ❌ | 64.0% ❌ |
| Red recall, any label | 70.5% | 86.8% | 71.4% | 67.7% | 67.8% |
| Micro precision | 83.8% | 65.8% | 87.5% | 89.0% | 54.6% |
| Micro recall | 68.9% | 71.0% | 70.0% | 66.4% | 64.0% |
| Micro F1 | 75.6% | 68.3% | 77.8% | 76.1% | 58.9% |
| **Safe text flagged** (FP rate) | 34.9% (542/1,553) | 77.0% (47/61) | 19.9% (119/599) | 29.6% (48/162) | 44.9% (328/731) |
| **Hard negatives flagged** | 73.4% (58/79) | 73.4% (58/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.01 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 26,951 | 0 | 22,439 | 1,944 | 2,568 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 1,908 | 3.3% | 100.0% | 6.4% | 6.4% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 2,535 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 1,837 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 3,499 | 4.2% | 96.7% | 8.1% | 7.9% | – |
| `unreleased-roadmap` | red | 157 | 1,075 | 12.7% | 86.6% | 22.1% | 21.3% | 88.0% (44/50) |
| `secrets` | red | 4,284 | 3,221 | 84.5% | 62.4% | 71.8% | 67.1% | 44.0% (11/25) |
| `customer-personal-data` | red | 108,095 | 70,033 | 96.2% | 69.2% | 80.5% | 65.5% | 50.0% (3/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 170 | 37.1% | 100.0% | 54.1% | 54.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 54 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 199 | 73.9% | 96.7% | 83.8% | 82.6% | – |
| `unreleased-roadmap` | red | 157 | 261 | 52.1% | 86.6% | 65.1% | 62.7% | 88.0% (44/50) |
| `secrets` | red | 49 | 25 | 48.0% | 24.5% | 32.4% | 29.7% | 44.0% (11/25) |
| `customer-personal-data` | red | 391 | 369 | 95.1% | 89.8% | 92.4% | 92.4% | 50.0% (3/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 952 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 2,324 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 841 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,881 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 372 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 2,821 | 89.6% | 63.5% | 74.3% | 69.4% | – |
| `customer-personal-data` | red | 78,611 | 49,161 | 98.7% | 70.3% | 82.1% | 63.4% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 182 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 57 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 269 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 395 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 242 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 198 | 56.6% | 76.7% | 65.1% | 61.0% | – |
| `customer-personal-data` | red | 21,164 | 13,858 | 96.8% | 66.3% | 78.7% | 72.5% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 604 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 154 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 673 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,024 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 200 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 177 | 40.1% | 39.0% | 39.6% | 37.9% | – |
| `customer-personal-data` | red | 7,929 | 6,645 | 76.8% | 64.5% | 70.2% | 66.1% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
