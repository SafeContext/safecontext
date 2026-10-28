# Evaluation: `predictions-tier1-small-ft-names-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-small-ft-names-t0.6.jsonl --split test`
- **Date:** 2026-10-28 03:32 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 113,521 | 1,002 | 82,175 | 21,688 | 8,656 |
| **Red recall** (target ≥ 95%) | 97.8% ✅ | 91.5% ❌ | 98.7% ✅ | 98.1% ✅ | 88.1% ❌ |
| Red recall, any label | 97.9% | 93.1% | 98.8% | 98.2% | 88.3% |
| Micro precision | 97.6% | 91.1% | 99.1% | 96.8% | 85.7% |
| Micro recall | 97.8% | 90.9% | 98.7% | 98.1% | 88.1% |
| Micro F1 | 97.7% | 91.0% | 98.9% | 97.5% | 86.9% |
| **Safe text flagged** (FP rate) | 8.1% (126/1,553) | 23.0% (14/61) | 2.0% (12/599) | 16.7% (27/162) | 10.0% (73/731) |
| **Hard negatives flagged** | 34.2% (27/79) | 34.2% (27/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 2,467 | 0 | 1,455 | 822 | 190 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 93 | 66.7% | 98.4% | 79.5% | 79.5% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 97 | 67.0% | 100.0% | 80.2% | 80.2% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 99 | 83.8% | 68.0% | 75.1% | 75.1% | – |
| `customer-names` | yellow | 152 | 213 | 71.4% | 100.0% | 83.3% | 83.3% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 4,284 | 4,079 | 97.9% | 93.3% | 95.5% | 94.8% | 0.0% (0/25) |
| `customer-personal-data` | red | 108,095 | 108,766 | 97.7% | 98.0% | 97.9% | 95.3% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 80 | 81.2% | 100.0% | 89.7% | 89.7% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 162 | 93.8% | 100.0% | 96.8% | 96.8% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 49 | 29 | 100.0% | 59.2% | 74.4% | 61.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 391 | 386 | 99.7% | 97.2% | 98.4% | 90.3% | 16.7% (1/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 8 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 2 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 23 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 3,730 | 99.1% | 94.7% | 96.9% | 96.4% | – |
| `customer-personal-data` | red | 78,611 | 78,412 | 99.1% | 98.9% | 99.0% | 97.9% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 10 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 15 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 162 | 84.6% | 94.5% | 89.3% | 86.4% | – |
| `customer-personal-data` | red | 21,164 | 21,498 | 97.0% | 98.2% | 97.6% | 93.2% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 13 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 158 | 81.6% | 70.9% | 75.9% | 74.1% | – |
| `customer-personal-data` | red | 7,929 | 8,470 | 86.1% | 88.4% | 87.2% | 76.3% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
