# Evaluation: `predictions-tier1-small-ft-names-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-small-ft-names-t0.6.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:32 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 6,322 | 1,002 | 1,810 | 1,481 | 2,029 |
| **Red recall** (target ≥ 95%) | 95.4% ✅ | 91.5% ❌ | 97.9% ✅ | 89.1% ❌ | 98.6% ✅ |
| Red recall, any label | 95.6% | 93.1% | 97.9% | 89.4% | 98.7% |
| Micro precision | 94.3% | 91.1% | 96.4% | 87.0% | 99.4% |
| Micro recall | 95.0% | 90.9% | 97.9% | 89.1% | 98.6% |
| Micro F1 | 94.7% | 91.0% | 97.1% | 88.0% | 99.0% |
| **Safe text flagged** (FP rate) | 11.4% (24/210) | 23.0% (14/61) | 7.7% (1/13) | 6.6% (8/121) | 6.7% (1/15) |
| **Hard negatives flagged** | 34.2% (27/79) | 34.2% (27/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.01 | 0.00 | 0.01 | 0.01 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 149 | 0 | 77 | 39 | 33 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 88 | 70.5% | 98.4% | 82.1% | 82.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 83 | 78.3% | 100.0% | 87.8% | 87.8% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 84 | 98.8% | 68.0% | 80.6% | 80.6% | – |
| `customer-names` | yellow | 152 | 167 | 91.0% | 100.0% | 95.3% | 95.3% | – |
| `unreleased-roadmap` | red | 157 | 174 | 78.7% | 87.3% | 82.8% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 189 | 160 | 96.9% | 82.0% | 88.8% | 85.4% | 0.0% (0/25) |
| `customer-personal-data` | red | 5,459 | 5,566 | 95.4% | 96.1% | 95.7% | 90.9% | 16.7% (1/6) |

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

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 2 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 15 | 80.0% | 100.0% | 88.9% | 88.9% | – |
| `customer-personal-data` | red | 1,760 | 1,792 | 96.7% | 97.8% | 97.3% | 93.8% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 28 | 92.9% | 74.3% | 82.5% | 82.5% | – |
| `customer-personal-data` | red | 1,358 | 1,448 | 87.2% | 89.5% | 88.3% | 77.6% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 88 | 100.0% | 94.6% | 97.2% | 96.1% | – |
| `customer-personal-data` | red | 1,950 | 1,940 | 99.4% | 98.8% | 99.1% | 97.9% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
