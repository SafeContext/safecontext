# Evaluation: `predictions-tier1-small-ft-names-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `dfe667ab75ef91b0…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-small-ft-names-t0.6.jsonl --split test`
- **Date:** 2026-11-04 03:29 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 77,479 | 849 | 55,148 | 17,154 | 4,328 |
| Predicted spans | 77,265 | 822 | 54,923 | 17,037 | 4,483 |
| **Red recall** (target ≥ 95%) | 97.8% ✅ | 89.9% ❌ | 98.6% ✅ | 98.2% ✅ | 87.2% ❌ |
| Red recall, any label | 97.9% | 90.6% | 98.7% | 98.3% | 87.4% |
| Micro precision | 98.0% | 92.6% | 99.0% | 98.7% | 84.1% |
| Micro recall | 97.8% | 89.6% | 98.6% | 98.2% | 87.2% |
| Micro F1 | 97.9% | 91.1% | 98.8% | 98.5% | 85.6% |
| **Safe text flagged** (FP rate) | 7.7% (182/2,355) | 9.8% (6/61) | 1.8% (18/999) | 9.4% (23/245) | 12.9% (135/1,050) |
| **Hard negatives flagged** | 25.3% (20/79) | 25.3% (20/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 1,749 | 0 | 1,043 | 628 | 78 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 91 | 68.1% | 98.4% | 80.5% | 80.5% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 74 | 82.4% | 93.8% | 87.8% | 87.8% | 21.1% (8/38) |
| `deal-sizes` | yellow | 122 | 101 | 83.2% | 68.9% | 75.3% | 75.3% | – |
| `customer-names` | yellow | 152 | 206 | 73.8% | 100.0% | 84.9% | 84.9% | – |
| `unreleased-roadmap` | red | 157 | 155 | 88.4% | 87.3% | 87.8% | 87.8% | 34.0% (17/50) |
| `secrets` | red | 4,284 | 4,064 | 97.8% | 92.8% | 95.2% | 94.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 72,636 | 72,574 | 98.2% | 98.1% | 98.2% | 96.5% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 69 | 88.4% | 93.8% | 91.0% | 91.0% | 21.1% (8/38) |
| `deal-sizes` | yellow | 122 | 89 | 94.4% | 68.9% | 79.6% | 79.6% | – |
| `customer-names` | yellow | 152 | 156 | 97.4% | 100.0% | 98.7% | 98.7% | – |
| `unreleased-roadmap` | red | 157 | 155 | 88.4% | 87.3% | 87.8% | 87.8% | 34.0% (17/50) |
| `secrets` | red | 49 | 25 | 100.0% | 51.0% | 67.6% | 48.6% | 0.0% (0/25) |
| `customer-personal-data` | red | 241 | 241 | 99.6% | 99.6% | 99.6% | 92.5% | 16.7% (1/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 22 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 3,731 | 99.0% | 94.5% | 96.7% | 96.2% | – |
| `customer-personal-data` | red | 51,241 | 51,163 | 99.1% | 98.9% | 99.0% | 97.6% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `deal-sizes` | yellow | 0 | 5 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 19 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 154 | 85.1% | 90.4% | 87.7% | 85.3% | – |
| `customer-personal-data` | red | 17,008 | 16,859 | 99.0% | 98.3% | 98.6% | 97.4% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 2 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 9 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 154 | 81.8% | 69.2% | 75.0% | 73.2% | – |
| `customer-personal-data` | red | 4,146 | 4,311 | 84.5% | 87.9% | 86.2% | 80.6% | – |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
