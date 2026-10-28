# Evaluation: `predictions-gliner-medium-v2.1-entity2-t0.4` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-medium-v2.1-entity2-t0.4.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 4,981 | 795 | 1,072 | 1,799 | 1,315 |
| **Red recall** (target ≥ 95%) | 28.9% ❌ | 37.0% ❌ | 17.7% ❌ | 34.7% ❌ | 32.3% ❌ |
| Red recall, any label | 49.1% | 48.4% | 52.1% | 44.9% | 49.5% |
| Micro precision | 33.1% | 54.0% | 23.3% | 26.7% | 37.4% |
| Micro recall | 30.4% | 42.9% | 17.7% | 34.7% | 32.3% |
| Micro F1 | 31.7% | 47.8% | 20.1% | 30.2% | 34.7% |
| **Safe text flagged** (FP rate) | 65.7% (138/210) | 95.1% (58/61) | 7.7% (1/13) | 61.2% (74/121) | 33.3% (5/15) |
| **Hard negatives flagged** | 31.6% (25/79) | 31.6% (25/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.01 | 0.00 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 1,002 | 0 | 136 | 414 | 452 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 588 | 10.7% | 100.0% | 19.4% | 19.4% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 85 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 136 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 981 | 14.8% | 95.4% | 25.6% | 25.6% | – |
| `unreleased-roadmap` | red | 157 | 1,169 | 4.6% | 34.4% | 8.1% | 8.1% | 14.0% (7/50) |
| `secrets` | red | 189 | 283 | 36.4% | 54.5% | 43.6% | 39.4% | 68.0% (17/25) |
| `customer-personal-data` | red | 5,459 | 1,739 | 74.0% | 27.9% | 40.5% | 24.8% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 203 | 31.0% | 100.0% | 47.4% | 47.4% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 1 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 2 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 260 | 55.8% | 95.4% | 70.4% | 70.4% | – |
| `unreleased-roadmap` | red | 157 | 105 | 51.4% | 34.4% | 41.2% | 41.2% | 14.0% (7/50) |
| `secrets` | red | 49 | 48 | 25.0% | 24.5% | 24.7% | 22.7% | 68.0% (17/25) |
| `customer-personal-data` | red | 391 | 176 | 88.1% | 39.6% | 54.7% | 52.6% | 16.7% (1/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 33 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 7 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 8 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 139 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 545 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 31 | 22.6% | 58.3% | 32.6% | 32.6% | – |
| `customer-personal-data` | red | 1,760 | 309 | 78.6% | 17.4% | 28.5% | 13.0% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 241 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 10 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 98 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 465 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 212 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 56 | 30.4% | 48.6% | 37.4% | 35.2% | – |
| `customer-personal-data` | red | 1,358 | 717 | 64.6% | 34.4% | 44.9% | 42.1% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 111 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 67 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 28 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 117 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 307 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 148 | 45.3% | 72.0% | 55.6% | 49.0% | – |
| `customer-personal-data` | red | 1,950 | 537 | 79.1% | 30.4% | 43.9% | 13.8% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
