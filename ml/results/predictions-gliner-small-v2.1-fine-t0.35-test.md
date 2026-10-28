# Evaluation: `predictions-gliner-small-v2.1-fine-t0.35` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-small-v2.1-fine-t0.35.jsonl --split test`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 128,208 | 1,125 | 86,024 | 22,627 | 18,432 |
| **Red recall** (target ≥ 95%) | 77.0% ❌ | 71.5% ❌ | 76.3% ❌ | 79.7% ❌ | 77.6% ❌ |
| Red recall, any label | 79.1% | 77.7% | 78.4% | 81.3% | 80.6% |
| Micro precision | 63.6% | 60.7% | 65.6% | 76.1% | 38.7% |
| Micro recall | 76.9% | 63.2% | 76.3% | 79.7% | 77.6% |
| Micro F1 | 69.6% | 61.9% | 70.6% | 77.8% | 51.7% |
| **Safe text flagged** (FP rate) | 56.4% (876/1,553) | 98.4% (60/61) | 36.6% (219/599) | 46.9% (76/162) | 71.3% (521/731) |
| **Hard negatives flagged** | 81.0% (64/79) | 81.0% (64/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.00 | 0.01 | 0.00 | 0.01 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 23,485 | 0 | 19,672 | 1,906 | 1,907 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 5,294 | 1.2% | 96.8% | 2.3% | 2.3% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 4,224 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 1,389 | 0.1% | 1.6% | 0.3% | 0.3% | – |
| `customer-names` | yellow | 152 | 6,832 | 2.1% | 92.8% | 4.0% | 4.0% | – |
| `unreleased-roadmap` | red | 157 | 768 | 14.8% | 72.6% | 24.6% | 24.6% | 78.0% (39/50) |
| `secrets` | red | 4,284 | 7,358 | 31.5% | 52.8% | 39.5% | 30.4% | 96.0% (24/25) |
| `customer-personal-data` | red | 108,095 | 102,343 | 77.0% | 77.9% | 77.5% | 50.9% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 210 | 29.0% | 96.8% | 44.7% | 44.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 10 | 20.0% | 1.6% | 3.0% | 3.0% | – |
| `customer-names` | yellow | 152 | 235 | 60.0% | 92.8% | 72.9% | 72.9% | – |
| `unreleased-roadmap` | red | 157 | 211 | 54.0% | 72.6% | 62.0% | 62.0% | 78.0% (39/50) |
| `secrets` | red | 49 | 65 | 21.5% | 24.5% | 22.9% | 17.5% | 96.0% (24/25) |
| `customer-personal-data` | red | 391 | 394 | 89.1% | 77.0% | 82.6% | 47.9% | 16.7% (1/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 3,016 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 3,719 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 933 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 3,843 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 256 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 6,567 | 33.0% | 54.2% | 41.1% | 31.8% | – |
| `customer-personal-data` | red | 78,611 | 67,690 | 80.2% | 77.4% | 78.8% | 51.2% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 373 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 78 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 271 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 851 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 229 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 375 | 17.6% | 45.2% | 25.3% | 21.1% | – |
| `customer-personal-data` | red | 21,164 | 20,450 | 83.8% | 79.9% | 81.8% | 54.9% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1,695 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 427 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 175 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,903 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 72 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 351 | 19.4% | 35.7% | 25.1% | 16.1% | – |
| `customer-personal-data` | red | 7,929 | 13,809 | 51.2% | 78.6% | 62.0% | 41.9% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
