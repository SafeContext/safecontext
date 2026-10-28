# Evaluation: `predictions-gliner-pii-base-v1.0-fine-t0.45` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-pii-base-v1.0-fine-t0.45.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 03:27 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 5,413 | 1,078 | 1,301 | 1,594 | 1,440 |
| **Red recall** (target ≥ 95%) | 68.9% ❌ | 83.6% ❌ | 67.3% ❌ | 64.6% ❌ | 68.9% ❌ |
| Red recall, any label | 71.6% | 86.8% | 68.7% | 69.6% | 71.0% |
| Micro precision | 74.3% | 65.8% | 89.2% | 56.3% | 87.2% |
| Micro recall | 67.8% | 71.0% | 67.3% | 64.6% | 68.9% |
| Micro F1 | 70.9% | 68.3% | 76.7% | 60.2% | 77.0% |
| **Safe text flagged** (FP rate) | 49.5% (104/210) | 77.0% (47/61) | 30.8% (4/13) | 42.1% (51/121) | 13.3% (2/15) |
| **Hard negatives flagged** | 73.4% (58/79) | 73.4% (58/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.01 | 0.00 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 1,181 | 0 | 172 | 438 | 571 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 284 | 22.2% | 100.0% | 36.3% | 36.3% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 86 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 186 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 466 | 31.5% | 96.7% | 47.6% | 46.9% | – |
| `unreleased-roadmap` | red | 157 | 315 | 43.2% | 86.6% | 57.6% | 55.5% | 88.0% (44/50) |
| `secrets` | red | 189 | 161 | 65.2% | 55.6% | 60.0% | 57.1% | 44.0% (11/25) |
| `customer-personal-data` | red | 5,459 | 3,915 | 91.2% | 68.8% | 78.5% | 70.2% | 50.0% (3/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 170 | 37.1% | 100.0% | 54.1% | 54.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 54 | 0.0% | 0.0% | 0.0% | 0.0% | – |
| `customer-names` | yellow | 152 | 199 | 73.9% | 96.7% | 83.8% | 82.6% | – |
| `unreleased-roadmap` | red | 157 | 261 | 52.1% | 86.6% | 65.1% | 62.7% | 88.0% (44/50) |
| `secrets` | red | 49 | 25 | 48.0% | 24.5% | 32.4% | 29.7% | 44.0% (11/25) |
| `customer-personal-data` | red | 391 | 369 | 95.1% | 89.8% | 92.4% | 92.4% | 50.0% (3/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 13 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 27 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 37 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 17 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 19 | 57.9% | 91.7% | 71.0% | 64.5% | – |
| `customer-personal-data` | red | 1,760 | 1,184 | 97.0% | 67.2% | 79.4% | 75.4% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 80 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 26 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 89 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 175 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 31 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 38 | 44.7% | 48.6% | 46.6% | 46.6% | – |
| `customer-personal-data` | red | 1,358 | 1,155 | 76.3% | 65.0% | 70.2% | 65.5% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 21 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 56 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 16 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 55 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 6 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 79 | 82.3% | 69.9% | 75.6% | 72.1% | – |
| `customer-personal-data` | red | 1,950 | 1,207 | 98.7% | 68.8% | 81.1% | 63.8% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
