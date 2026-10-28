# Evaluation: `predictions-gliner-large-v2.1-entity2-t0.3` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-large-v2.1-entity2-t0.3.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 6,100 | 1,041 | 1,333 | 2,269 | 1,457 |
| **Red recall** (target ≥ 95%) | 47.5% ❌ | 50.6% ❌ | 45.7% ❌ | 47.1% ❌ | 48.6% ❌ |
| Red recall, any label | 54.0% | 60.3% | 56.4% | 51.0% | 52.0% |
| Micro precision | 46.2% | 58.5% | 55.2% | 28.8% | 56.1% |
| Micro recall | 49.4% | 60.9% | 45.7% | 47.1% | 48.6% |
| Micro F1 | 47.7% | 59.7% | 50.0% | 35.7% | 52.1% |
| **Safe text flagged** (FP rate) | 75.2% (158/210) | 100.0% (61/61) | 46.2% (6/13) | 70.2% (85/121) | 40.0% (6/15) |
| **Hard negatives flagged** | 88.6% (70/79) | 88.6% (70/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.01 | 0.00 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 1,130 | 0 | 160 | 402 | 568 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 439 | 14.4% | 100.0% | 25.1% | 25.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 121 | 5.8% | 10.8% | 7.5% | 0.0% | 5.3% (2/38) |
| `deal-sizes` | yellow | 122 | 490 | 17.3% | 69.7% | 27.8% | 27.8% | – |
| `customer-names` | yellow | 152 | 892 | 16.9% | 99.3% | 28.9% | 28.9% | – |
| `unreleased-roadmap` | red | 157 | 365 | 18.9% | 43.9% | 26.4% | 26.4% | 94.0% (47/50) |
| `secrets` | red | 189 | 560 | 24.5% | 70.9% | 36.4% | 31.2% | 84.0% (21/25) |
| `customer-personal-data` | red | 5,459 | 3,233 | 71.3% | 46.8% | 56.5% | 37.8% | 50.0% (3/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 103 | 61.2% | 100.0% | 75.9% | 75.9% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 51 | 13.7% | 10.8% | 12.1% | 0.0% | 5.3% (2/38) |
| `deal-sizes` | yellow | 122 | 102 | 83.3% | 69.7% | 75.9% | 75.9% | – |
| `customer-names` | yellow | 152 | 254 | 59.4% | 99.3% | 74.4% | 74.4% | – |
| `unreleased-roadmap` | red | 157 | 176 | 39.2% | 43.9% | 41.4% | 41.4% | 94.0% (47/50) |
| `secrets` | red | 49 | 106 | 27.4% | 57.1% | 37.0% | 27.1% | 84.0% (21/25) |
| `customer-personal-data` | red | 391 | 249 | 82.3% | 52.4% | 64.1% | 58.4% | 50.0% (3/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 20 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 5 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 33 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 111 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 140 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 104 | 11.5% | 100.0% | 20.7% | 20.7% | – |
| `customer-personal-data` | red | 1,760 | 920 | 78.7% | 45.3% | 57.5% | 37.3% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 242 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 12 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 295 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 396 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 30 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 151 | 13.9% | 57.1% | 22.4% | 19.4% | – |
| `customer-personal-data` | red | 1,358 | 1,143 | 55.3% | 46.8% | 50.7% | 46.9% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 74 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 53 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 60 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 131 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 19 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 199 | 37.7% | 79.6% | 51.1% | 45.2% | – |
| `customer-personal-data` | red | 1,950 | 921 | 80.7% | 47.1% | 59.5% | 25.7% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
