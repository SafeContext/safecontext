# Evaluation: `predictions-tier1-small-ft-staff-names-t0.6` on `test`

- **Data:** `test.jsonl`, sha256 `1bd3ad4f910c457b…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval predictions:results/preds/tier1-small-ft-staff-names-t0.6.jsonl --split test`
- **Date:** 2026-11-04 01:17 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- **Sensitive labels:** micro scores and *Safe text flagged* use the yellow and red labels only. `staff-names` is green by default, so it has its own row below and doesn't flag a document.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels and `staff-names` come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 113,006 | 1,067 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 113,511 | 1,085 | 82,173 | 21,637 | 8,616 |
| **Red recall** (target ≥ 95%) | 97.8% ✅ | 89.9% ❌ | 98.8% ✅ | 98.1% ✅ | 88.1% ❌ |
| Red recall, any label | 97.9% | 91.5% | 98.8% | 98.1% | 88.3% |
| Micro precision | 97.6% | 91.0% | 99.1% | 96.8% | 85.8% |
| Micro recall | 97.8% | 90.3% | 98.8% | 98.1% | 88.1% |
| Micro F1 | 97.7% | 90.6% | 98.9% | 97.4% | 86.9% |
| **Safe text flagged** (FP rate) | 9.0% (140/1,553) | 21.3% (13/61) | 2.7% (16/599) | 15.4% (25/162) | 11.8% (86/731) |
| **Hard negatives flagged** | 36.7% (29/79) | 36.7% (29/79) | – | – | – |
| Latency p50 (ms) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Latency p95 (ms) | 0.00 | 0.01 | 0.00 | 0.00 | 0.00 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 2,358 | 0 | 1,346 | 823 | 189 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `staff-names` | green | 68 | 64 | 100.0% | 94.1% | 97.0% | 95.5% | – |
| `revenue-figures` | yellow | 63 | 103 | 61.2% | 100.0% | 75.9% | 75.9% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 100 | 65.0% | 100.0% | 78.8% | 78.8% | 31.6% (12/38) |
| `deal-sizes` | yellow | 122 | 94 | 90.4% | 69.7% | 78.7% | 78.7% | – |
| `customer-names` | yellow | 152 | 210 | 72.4% | 100.0% | 84.0% | 84.0% | – |
| `unreleased-roadmap` | red | 157 | 171 | 77.2% | 84.1% | 80.5% | 80.5% | 52.0% (26/50) |
| `secrets` | red | 4,284 | 4,068 | 97.7% | 92.9% | 95.2% | 94.6% | 0.0% (0/25) |
| `customer-personal-data` | red | 108,095 | 108,701 | 97.7% | 98.0% | 97.9% | 95.3% | 0.0% (0/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `staff-names` | green | 68 | 64 | 100.0% | 94.1% | 97.0% | 95.5% | – |
| `revenue-figures` | yellow | 63 | 95 | 66.3% | 100.0% | 79.7% | 79.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 77 | 84.4% | 100.0% | 91.5% | 91.5% | 31.6% (12/38) |
| `deal-sizes` | yellow | 122 | 85 | 100.0% | 69.7% | 82.1% | 82.1% | – |
| `customer-names` | yellow | 152 | 160 | 95.0% | 100.0% | 97.4% | 97.4% | – |
| `unreleased-roadmap` | red | 157 | 171 | 77.2% | 84.1% | 80.5% | 80.5% | 52.0% (26/50) |
| `secrets` | red | 49 | 24 | 100.0% | 49.0% | 65.8% | 60.3% | 0.0% (0/25) |
| `customer-personal-data` | red | 391 | 409 | 99.8% | 97.4% | 98.6% | 81.8% | 0.0% (0/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 12 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 3 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 22 | 0.0% | – | – | – | – |
| `secrets` | red | 3,907 | 3,719 | 99.2% | 94.4% | 96.8% | 96.4% | – |
| `customer-personal-data` | red | 78,611 | 78,416 | 99.1% | 99.0% | 99.1% | 97.8% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `internal-metrics` | yellow | 0 | 4 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 5 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 14 | 0.0% | – | – | – | – |
| `secrets` | red | 146 | 155 | 87.1% | 93.2% | 90.0% | 87.0% | – |
| `customer-personal-data` | red | 21,164 | 21,459 | 97.0% | 98.1% | 97.5% | 93.1% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 0 | 7 | 0.0% | – | – | – | – |
| `internal-metrics` | yellow | 0 | 7 | 0.0% | – | – | – | – |
| `deal-sizes` | yellow | 0 | 1 | 0.0% | – | – | – | – |
| `customer-names` | yellow | 0 | 14 | 0.0% | – | – | – | – |
| `secrets` | red | 182 | 170 | 75.3% | 70.3% | 72.7% | 70.5% | – |
| `customer-personal-data` | red | 7,929 | 8,417 | 86.3% | 88.5% | 87.4% | 77.3% | – |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
