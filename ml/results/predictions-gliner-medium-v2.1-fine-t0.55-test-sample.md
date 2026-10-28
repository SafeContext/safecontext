# Evaluation: `predictions-gliner-medium-v2.1-fine-t0.55` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-medium-v2.1-fine-t0.55.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 04:01 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 6,986 | 1,001 | 1,713 | 2,292 | 1,980 |
| **Red recall** (target ≥ 95%) | 74.2% ❌ | 76.9% ❌ | 71.4% ❌ | 74.6% ❌ | 75.6% ❌ |
| Red recall, any label | 75.9% | 78.2% | 73.4% | 76.1% | 77.2% |
| Micro precision | 64.3% | 67.3% | 75.5% | 49.5% | 70.1% |
| Micro recall | 72.5% | 65.2% | 71.4% | 74.6% | 75.6% |
| Micro F1 | 68.1% | 66.2% | 73.4% | 59.5% | 72.7% |
| **Safe text flagged** (FP rate) | 58.6% (123/210) | 78.7% (48/61) | 30.8% (4/13) | 55.4% (67/121) | 26.7% (4/15) |
| **Hard negatives flagged** | 72.2% (57/79) | 72.2% (57/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.00 | 0.00 | 0.01 | 0.01 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 555 | 0 | 137 | 108 | 310 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 354 | 17.2% | 96.8% | 29.3% | 29.3% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 96 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 202 | 9.4% | 15.6% | 11.7% | 11.7% | – |
| `customer-names` | yellow | 152 | 294 | 38.1% | 73.7% | 50.2% | 50.2% | – |
| `unreleased-roadmap` | red | 157 | 341 | 37.8% | 82.2% | 51.8% | 51.8% | 82.0% (41/50) |
| `secrets` | red | 189 | 280 | 30.0% | 44.4% | 35.8% | 32.8% | 64.0% (16/25) |
| `customer-personal-data` | red | 5,459 | 5,419 | 75.4% | 75.0% | 75.2% | 53.3% | 0.0% (0/6) |

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

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 5 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 40 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 23 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 31 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 36 | 13.9% | 41.7% | 20.8% | 20.8% | – |
| `customer-personal-data` | red | 1,760 | 1,575 | 81.8% | 71.6% | 76.4% | 54.3% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 109 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 28 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 109 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 97 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 40 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 37 | 29.7% | 31.4% | 30.6% | 30.6% | – |
| `customer-personal-data` | red | 1,358 | 1,872 | 60.0% | 75.7% | 67.0% | 46.6% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 58 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 63 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 21 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 29 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 37 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 156 | 34.0% | 57.0% | 42.6% | 38.6% | – |
| `customer-personal-data` | red | 1,950 | 1,616 | 82.6% | 76.5% | 79.4% | 57.6% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
