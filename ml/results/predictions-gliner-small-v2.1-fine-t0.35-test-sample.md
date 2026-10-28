# Evaluation: `predictions-gliner-small-v2.1-fine-t0.35` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-small-v2.1-fine-t0.35.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 8,260 | 1,125 | 1,925 | 3,074 | 2,136 |
| **Red recall** (target ≥ 95%) | 74.9% ❌ | 71.5% ❌ | 79.0% ❌ | 75.3% ❌ | 72.1% ❌ |
| Red recall, any label | 78.4% | 77.7% | 80.9% | 79.8% | 75.6% |
| Micro precision | 56.5% | 60.7% | 75.2% | 38.9% | 62.6% |
| Micro recall | 73.4% | 63.2% | 79.0% | 75.3% | 72.1% |
| Micro F1 | 63.8% | 61.9% | 77.0% | 51.3% | 67.0% |
| **Safe text flagged** (FP rate) | 75.7% (159/210) | 98.4% (60/61) | 30.8% (4/13) | 72.7% (88/121) | 46.7% (7/15) |
| **Hard negatives flagged** | 81.0% (64/79) | 81.0% (64/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.00 | 0.00 | 0.01 | 0.01 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 984 | 0 | 154 | 309 | 521 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 516 | 11.8% | 96.8% | 21.1% | 21.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 163 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 70 | 2.9% | 1.6% | 2.1% | 2.1% | – |
| `customer-names` | yellow | 152 | 734 | 19.2% | 92.8% | 31.8% | 31.8% | – |
| `unreleased-roadmap` | red | 157 | 263 | 43.3% | 72.6% | 54.3% | 54.3% | 78.0% (39/50) |
| `secrets` | red | 189 | 338 | 26.0% | 45.0% | 33.0% | 25.8% | 96.0% (24/25) |
| `customer-personal-data` | red | 5,459 | 6,176 | 69.0% | 76.0% | 72.3% | 48.2% | 16.7% (1/6) |

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

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 29 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 24 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 77 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 26 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 48 | 18.8% | 75.0% | 30.0% | 26.7% | – |
| `customer-personal-data` | red | 1,760 | 1,717 | 83.8% | 79.0% | 81.3% | 55.1% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 238 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 76 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 18 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 311 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 16 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 45 | 24.4% | 28.6% | 26.3% | 17.5% | – |
| `customer-personal-data` | red | 1,358 | 2,370 | 50.0% | 76.5% | 60.5% | 41.0% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 39 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 83 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 18 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 111 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 10 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 180 | 30.0% | 58.1% | 39.6% | 31.5% | – |
| `customer-personal-data` | red | 1,950 | 1,695 | 75.8% | 72.8% | 74.2% | 49.0% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
