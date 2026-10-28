# Evaluation: `predictions-regex+tier1-small-ft-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/regex+tier1-small-ft-t0.6.jsonl`
- **Date:** 2026-10-28 03:33 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 114,629 | 1,036 | 82,455 | 21,827 | 9,311 |
| **Red recall** (target ≥ 95%) | 97.9% ✅ | 94.1% ❌ | 98.8% ✅ | 98.2% ✅ | 89.0% ❌ |
| Red recall, any label | 98.0% | 95.8% | 98.8% | 98.2% | 89.2% |
| Micro precision | 97.0% | 90.3% | 99.0% | 96.7% | 80.9% |
| Micro recall | 97.9% | 92.5% | 98.8% | 98.2% | 89.0% |
| Micro F1 | 97.5% | 91.4% | 98.9% | 97.4% | 84.8% |
| **Safe text flagged** (FP rate) | 9.5% (147/1,553) | 36.1% (22/61) | 2.2% (13/599) | 16.7% (27/162) | 11.6% (85/731) |
| **Hard negatives flagged** | 44.3% (35/79) | 44.3% (35/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.01 | 0.01 | 0.00 | 0.01 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 3,278 | 0 | 2,252 | 823 | 203 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 93 | 66.7% | 98.4% | 79.5% | 79.5% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 97 | 67.0% | 100.0% | 80.2% | 80.2% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 99 | 83.8% | 68.0% | 75.1% | 75.1% | – |
| `customer-names` | yellow | 152 | 213 | 71.4% | 100.0% | 83.3% | 83.3% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 4,284 | 4,213 | 97.4% | 93.7% | 95.5% | 94.0% | 24.0% (6/25) |
| `customer-personal-data` | red | 108,095 | 109,740 | 97.2% | 98.1% | 97.6% | 95.0% | 83.3% (5/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 80 | 81.2% | 100.0% | 89.7% | 89.7% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 162 | 93.8% | 100.0% | 96.8% | 96.8% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 49 | 58 | 86.2% | 91.8% | 88.9% | 84.1% | 24.0% (6/25) |
| `customer-personal-data` | red | 391 | 391 | 98.7% | 97.2% | 97.9% | 90.0% | 83.3% (5/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 8 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 2 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 23 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 3,814 | 98.9% | 94.7% | 96.7% | 95.5% | – |
| `customer-personal-data` | red | 78,611 | 78,608 | 99.1% | 99.0% | 99.0% | 97.9% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 10 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 15 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 171 | 83.6% | 94.5% | 88.7% | 83.9% | – |
| `customer-personal-data` | red | 21,164 | 21,628 | 96.9% | 98.2% | 97.6% | 93.1% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 13 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 170 | 80.6% | 73.1% | 76.6% | 74.4% | – |
| `customer-personal-data` | red | 7,929 | 9,113 | 81.2% | 89.4% | 85.1% | 74.1% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
