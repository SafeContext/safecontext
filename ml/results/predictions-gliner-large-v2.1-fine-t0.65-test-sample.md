# Evaluation: `predictions-gliner-large-v2.1-fine-t0.65` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 1,705 of 29,018 records (at most 500 per source, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/gliner-large-v2.1-fine-t0.65.jsonl --split test --per-source 500`
- **Date:** 2026-10-28 05:06 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | gretel-pii-en | gretel-pii-finance | nemotron-pii |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 1,705 | 205 | 500 | 500 | 500 |
| Gold spans | 6,207 | 999 | 1,772 | 1,393 | 2,043 |
| Predicted spans | 7,556 | 1,093 | 1,964 | 2,438 | 2,061 |
| **Red recall** (target ≥ 95%) | 83.9% ❌ | 87.3% ❌ | 84.9% ❌ | 80.8% ❌ | 84.0% ❌ |
| Red recall, any label | 84.7% | 89.3% | 85.7% | 81.3% | 84.7% |
| Micro precision | 66.2% | 73.8% | 75.5% | 47.1% | 75.8% |
| Micro recall | 82.9% | 79.8% | 84.9% | 80.8% | 84.0% |
| Micro F1 | 73.6% | 76.7% | 79.9% | 59.5% | 79.7% |
| **Safe text flagged** (FP rate) | 69.5% (146/210) | 91.8% (56/61) | 46.2% (6/13) | 66.1% (80/121) | 26.7% (4/15) |
| **Hard negatives flagged** | 86.1% (68/79) | 86.1% (68/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.01 | 0.00 | 0.00 | 0.01 | 0.01 |
| Mean chars / record | 785 | 221 | 226 | 1,381 | 979 |
| Predictions dropped (ignore regions) | 491 | 0 | 156 | 80 | 255 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 286 | 22.0% | 100.0% | 36.1% | 36.1% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 134 | 0.0% | 0.0% | 0.0% | 0.0% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 162 | 46.3% | 61.5% | 52.8% | 52.8% | – |
| `customer-names` | yellow | 152 | 268 | 51.5% | 90.8% | 65.7% | 65.7% | – |
| `unreleased-roadmap` | red | 157 | 253 | 56.5% | 91.1% | 69.8% | 69.8% | 88.0% (44/50) |
| `secrets` | red | 189 | 384 | 25.8% | 51.3% | 34.3% | 29.3% | 84.0% (21/25) |
| `customer-personal-data` | red | 5,459 | 6,069 | 73.8% | 84.8% | 78.9% | 60.8% | 66.7% (4/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 93 | 67.7% | 100.0% | 80.8% | 80.8% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 59 | 0.0% | 0.0% | 0.0% | 0.0% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 75 | 100.0% | 61.5% | 76.1% | 76.1% | – |
| `customer-names` | yellow | 152 | 143 | 96.5% | 90.8% | 93.6% | 93.6% | – |
| `unreleased-roadmap` | red | 157 | 226 | 63.3% | 91.1% | 74.7% | 74.7% | 88.0% (44/50) |
| `secrets` | red | 49 | 61 | 13.1% | 14.3% | 13.7% | 3.6% | 84.0% (21/25) |
| `customer-personal-data` | red | 391 | 436 | 87.2% | 94.9% | 90.9% | 65.8% | 66.7% (4/6) |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 6 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 10 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 31 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 16 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 16 | 0.0% | – | – | – | – |
| `secrets` | red | 12 | 60 | 16.7% | 83.3% | 27.8% | 27.8% | – |
| `customer-personal-data` | red | 1,760 | 1,825 | 80.7% | 84.9% | 82.7% | 63.7% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 157 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 23 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 47 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 84 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 4 | 0.0% | – | – | – | – |
| `secrets` | red | 35 | 100 | 18.0% | 48.6% | 26.3% | 23.7% | – |
| `customer-personal-data` | red | 1,358 | 2,023 | 55.9% | 81.7% | 66.3% | 50.0% | – |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 30 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 42 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 9 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 25 | 0.0% | – | – | – | – |
| `unreleased-roadmap` | red | 0 | 7 | 0.0% | – | – | – | – |
| `secrets` | red | 93 | 163 | 38.7% | 67.7% | 49.2% | 43.8% | – |
| `customer-personal-data` | red | 1,950 | 1,785 | 84.0% | 84.8% | 84.4% | 66.6% | – |

## Task preservation (LLM judge)

Not run. It is paid and opt-in: `--judge N` picks N records the model changed and prints a cost estimate; add `--yes` to send the requests.
