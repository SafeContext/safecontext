# Evaluation: `predictions-gliner-small-v2.1-entity2-t0.15` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-small-v2.1-entity2-t0.15.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 7,558 | 967 | 1,294 | 3,354 | 1,943 |
| **Red recall** (target ≥ 95%) | 43.5% ❌ | 38.0% ❌ | 39.7% ❌ | 39.7% ❌ | 50.9% ❌ |
| Red recall, any label | 57.4% | 58.0% | 55.0% | 56.0% | 60.4% |
| Micro precision | 33.3% | 45.3% | 49.5% | 16.4% | 45.8% |
| Micro recall | 44.0% | 43.5% | 39.7% | 39.7% | 50.9% |
| Micro F1 | 37.9% | 44.4% | 44.0% | 23.2% | 48.2% |
| **Safe text flagged** (FP rate) | 72.9% (153/210) | 95.1% (58/61) | 23.1% (3/13) | 71.1% (86/121) | 40.0% (6/15) |
| **Hard negatives flagged** | 41.8% (33/79) | 41.8% (33/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.00 | 0.00 | 0.01 | 0.01 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 1,140 | 0 | 133 | 487 | 520 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 1,075 | 5.9% | 100.0% | 11.1% | 11.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 157 | 0.0% | 0.0% | 0.0% | 0.0% | 2.6% (1/38) |
| `deal-sizes` | yellow | 122 | 260 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 1,914 | 7.6% | 95.4% | 14.0% | 14.0% | – |
| `unreleased-roadmap` | red | 157 | 162 | 14.2% | 14.6% | 14.4% | 14.4% | 16.0% (8/50) |
| `secrets` | red | 189 | 402 | 27.1% | 57.7% | 36.9% | 30.8% | 92.0% (23/25) |
| `customer-personal-data` | red | 5,459 | 3,588 | 60.7% | 43.8% | 50.9% | 32.0% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 272 | 23.2% | 100.0% | 37.6% | 37.6% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 1 | 0.0% | 0.0% | 0.0% | 0.0% | 2.6% (1/38) |
| `deal-sizes` | yellow | 122 | 0 | – | 0.0% | – | – | – |
| `customer-names` | yellow | 152 | 348 | 41.7% | 95.4% | 58.0% | 58.0% | – |
| `unreleased-roadmap` | red | 157 | 41 | 56.1% | 14.6% | 23.2% | 23.2% | 16.0% (8/50) |
| `secrets` | red | 49 | 64 | 20.3% | 26.5% | 23.0% | 21.2% | 92.0% (23/25) |
| `customer-personal-data` | red | 391 | 241 | 80.5% | 48.8% | 60.8% | 38.0% | 16.7% (1/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 88 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 12 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 13 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 248 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 72 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 47 | 23.4% | 91.7% | 37.3% | 30.5% | – |
| `customer-personal-data` | red | 1,760 | 814 | 77.3% | 39.3% | 52.1% | 32.8% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 553 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 35 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 196 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 1,053 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 37 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 111 | 17.1% | 54.3% | 26.0% | 21.9% | – |
| `customer-personal-data` | red | 1,358 | 1,369 | 38.9% | 39.3% | 39.1% | 34.3% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 162 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 109 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 51 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 265 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 12 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 180 | 36.7% | 71.0% | 48.4% | 39.6% | – |
| `customer-personal-data` | red | 1,950 | 1,164 | 70.7% | 49.9% | 58.5% | 28.1% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
