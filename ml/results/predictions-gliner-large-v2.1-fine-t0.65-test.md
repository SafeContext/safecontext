# Evaluation: `predictions-gliner-large-v2.1-fine-t0.65` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-large-v2.1-fine-t0.65.jsonl --split test`
- **Date:** 2026-10-28 05:06 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 121,953 | 1,093 | 83,740 | 22,788 | 14,332 |
| **Red recall** (target ≥ 95%) | 85.1% ❌ | 87.3% ❌ | 85.7% ❌ | 84.1% ❌ | 80.9% ❌ |
| Red recall, any label | 85.8% | 89.3% | 86.2% | 85.4% | 81.6% |
| Micro precision | 72.8% | 73.8% | 76.3% | 76.2% | 46.6% |
| Micro recall | 85.0% | 79.8% | 85.7% | 84.1% | 80.9% |
| Micro F1 | 78.4% | 76.7% | 80.7% | 80.0% | 59.2% |
| **Safe text flagged** (FP rate) | 55.6% (864/1,553) | 91.8% (56/61) | 36.4% (218/599) | 51.9% (84/162) | 69.2% (506/731) |
| **Hard negatives flagged** | 86.1% (68/79) | 86.1% (68/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.01 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 11,022 | 0 | 8,536 | 1,909 | 577 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 2,680 | 2.4% | 100.0% | 4.6% | 4.6% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 2,119 | 0.0% | 0.0% | 0.0% | 0.0% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 1,334 | 5.6% | 61.5% | 10.3% | 10.3% | – |
| `customer-names` | yellow | 152 | 1,827 | 7.6% | 90.8% | 13.9% | 13.9% | – |
| `unreleased-roadmap` | red | 157 | 850 | 16.8% | 91.1% | 28.4% | 28.4% | 88.0% (44/50) |
| `secrets` | red | 4,284 | 7,553 | 37.8% | 65.9% | 48.1% | 39.8% | 84.0% (21/25) |
| `customer-personal-data` | red | 108,095 | 105,590 | 81.0% | 85.8% | 83.3% | 64.1% | 66.7% (4/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 93 | 67.7% | 100.0% | 80.8% | 80.8% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 59 | 0.0% | 0.0% | 0.0% | 0.0% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 75 | 100.0% | 61.5% | 76.1% | 76.1% | – |
| `customer-names` | yellow | 152 | 143 | 96.5% | 90.8% | 93.6% | 93.6% | – |
| `unreleased-roadmap` | red | 157 | 226 | 63.3% | 91.1% | 74.7% | 74.7% | 88.0% (44/50) |
| `secrets` | red | 49 | 61 | 13.1% | 14.3% | 13.7% | 3.6% | 84.0% (21/25) |
| `customer-personal-data` | red | 391 | 436 | 87.2% | 94.9% | 90.9% | 65.8% | 66.7% (4/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1,451 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 1,786 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 615 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,035 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 447 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 6,043 | 44.6% | 68.3% | 54.0% | 44.8% | – |
| `customer-personal-data` | red | 78,611 | 72,363 | 84.6% | 86.6% | 85.6% | 66.3% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 79 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 115 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 341 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 186 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 151 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 576 | 15.5% | 58.9% | 24.5% | 21.3% | – |
| `customer-personal-data` | red | 21,164 | 21,340 | 81.0% | 84.3% | 82.6% | 61.9% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1,057 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 159 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 303 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 463 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 26 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 873 | 7.7% | 34.6% | 12.6% | 9.5% | – |
| `customer-personal-data` | red | 7,929 | 11,451 | 57.8% | 82.0% | 67.8% | 51.8% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
