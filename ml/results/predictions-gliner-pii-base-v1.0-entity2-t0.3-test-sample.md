# Evaluation: `predictions-gliner-pii-base-v1.0-entity2-t0.3` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-pii-base-v1.0-entity2-t0.3.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 3,970 | 868 | 444 | 1,804 | 854 |
| **Red recall** (target ≥ 95%) | 22.5% ❌ | 32.7% ❌ | 9.4% ❌ | 29.6% ❌ | 26.0% ❌ |
| Red recall, any label | 33.0% | 42.9% | 17.9% | 43.6% | 36.0% |
| Micro precision | 34.2% | 48.6% | 31.1% | 22.8% | 45.2% |
| Micro recall | 24.5% | 41.4% | 9.4% | 29.6% | 26.0% |
| Micro F1 | 28.6% | 44.7% | 14.4% | 25.7% | 33.0% |
| **Safe text flagged** (FP rate) | 66.7% (140/210) | 95.1% (58/61) | 23.1% (3/13) | 63.6% (77/121) | 13.3% (2/15) |
| **Hard negatives flagged** | 72.2% (57/79) | 72.2% (57/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.01 | 0.00 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 1,138 | 0 | 113 | 487 | 538 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 790 | 8.0% | 100.0% | 14.8% | 14.8% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 289 | 1.7% | 7.7% | 2.8% | 2.8% | 50.0% (19/38) |
| `deal-sizes` | yellow | 122 | 156 | 1.3% | 1.6% | 1.4% | 0.7% | – |
| `customer-names` | yellow | 152 | 936 | 15.9% | 98.0% | 27.4% | 26.7% | – |
| `unreleased-roadmap` | red | 157 | 151 | 6.6% | 6.4% | 6.5% | 6.5% | 38.0% (19/50) |
| `secrets` | red | 189 | 569 | 30.8% | 85.2% | 45.2% | 38.5% | 100.0% (25/25) |
| `customer-personal-data` | red | 5,459 | 1,079 | 88.3% | 20.8% | 33.6% | 22.7% | 0.0% (0/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 247 | 25.5% | 100.0% | 40.6% | 40.6% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 32 | 15.6% | 7.7% | 10.3% | 10.3% | 50.0% (19/38) |
| `deal-sizes` | yellow | 122 | 2 | 100.0% | 1.6% | 3.2% | 1.6% | – |
| `customer-names` | yellow | 152 | 280 | 53.2% | 98.0% | 69.0% | 67.1% | – |
| `unreleased-roadmap` | red | 157 | 45 | 22.2% | 6.4% | 9.9% | 9.9% | 38.0% (19/50) |
| `secrets` | red | 49 | 95 | 50.5% | 81.6% | 62.4% | 41.7% | 100.0% (25/25) |
| `customer-personal-data` | red | 391 | 167 | 86.8% | 37.1% | 52.0% | 52.0% | 0.0% (0/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 28 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 43 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 65 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 41 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 117 | 10.3% | 100.0% | 18.6% | 17.1% | – |
| `customer-personal-data` | red | 1,760 | 146 | 86.3% | 8.8% | 15.9% | 10.2% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 448 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 73 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 123 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 475 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 37 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 183 | 13.7% | 71.4% | 22.9% | 22.0% | – |
| `customer-personal-data` | red | 1,358 | 465 | 83.0% | 28.5% | 42.4% | 40.7% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 67 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 141 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 27 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 116 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 28 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 174 | 51.7% | 90.3% | 65.8% | 60.7% | – |
| `customer-personal-data` | red | 1,950 | 301 | 98.3% | 22.9% | 37.2% | 11.6% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
