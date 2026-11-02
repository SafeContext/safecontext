# Evaluation: `regex` on `test`

- **Data:** `test.jsonl`, sha256 `1aec53bb6700782d…`; 29,018 of 29,018 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval regex --judge 100`
- **Date:** 2026-10-27 22:16 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline | nemotron-pii | gretel-pii-en | gretel-pii-finance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Records | 29,018 | 205 | 19,940 | 5,947 | 2,926 |
| Gold spans | 112,938 | 999 | 82,518 | 21,310 | 8,111 |
| Predicted spans | 23,736 | 191 | 18,351 | 3,638 | 1,556 |
| **Red recall** (target ≥ 95%) | 20.2% ❌ | 30.0% ❌ | 22.0% ❌ | 16.8% ❌ | 10.9% ❌ |
| Red recall, any label | 20.2% | 30.0% | 22.0% | 16.8% | 10.9% |
| Micro precision | 95.9% | 93.7% | 98.7% | 98.4% | 56.9% |
| Micro recall | 20.2% | 17.9% | 22.0% | 16.8% | 10.9% |
| Micro F1 | 33.3% | 30.1% | 35.9% | 28.7% | 18.3% |
| **Safe text flagged** (FP rate) | 2.8% (43/1,553) | 13.1% (8/61) | 1.2% (7/599) | 1.2% (2/162) | 3.6% (26/731) |
| **Hard negatives flagged** | 10.1% (8/79) | 10.1% (8/79) | – | – | – |
| Latency p50 (ms) | 0.13 | 0.04 | 0.15 | 0.04 | 0.28 |
| Latency p95 (ms) | 0.44 | 0.08 | 0.47 | 0.10 | 0.45 |
| Mean chars / record | 858 | 221 | 976 | 216 | 1,401 |
| Predictions dropped (ignore regions) | 831 | 0 | 814 | 1 | 16 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` * | yellow | 63 | 0 | – | 0.0% | – | – | 0.0% (0/21) |
| `internal-metrics` * | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` * | yellow | 122 | 0 | – | 0.0% | – | – | – |
| `customer-names` * | yellow | 152 | 0 | – | 0.0% | – | – | – |
| `unreleased-roadmap` * | red | 157 | 0 | – | 0.0% | – | – | 0.0% (0/50) |
| `secrets` | red | 4,284 | 551 | 94.0% | 12.1% | 21.4% | 18.2% | 24.0% (6/25) |
| `customer-personal-data` | red | 108,095 | 23,185 | 95.9% | 20.6% | 33.9% | 33.5% | 66.7% (4/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` * | yellow | 63 | 0 | – | 0.0% | – | – | 0.0% (0/21) |
| `internal-metrics` * | yellow | 65 | 0 | – | 0.0% | – | – | 0.0% (0/38) |
| `deal-sizes` * | yellow | 122 | 0 | – | 0.0% | – | – | – |
| `customer-names` * | yellow | 152 | 0 | – | 0.0% | – | – | – |
| `unreleased-roadmap` * | red | 157 | 0 | – | 0.0% | – | – | 0.0% (0/50) |
| `secrets` | red | 49 | 50 | 84.0% | 85.7% | 84.8% | 84.8% | 24.0% (6/25) |
| `customer-personal-data` | red | 391 | 141 | 97.2% | 35.0% | 51.5% | 51.5% | 66.7% (4/6) |

## Per label: nemotron-pii

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `secrets` | red | 3,907 | 401 | 96.8% | 9.9% | 18.0% | 14.9% | – |
| `customer-personal-data` | red | 78,611 | 17,950 | 98.8% | 22.6% | 36.7% | 36.5% | – |

## Per label: gretel-pii-en

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `secrets` | red | 146 | 63 | 90.5% | 39.0% | 54.5% | 48.8% | – |
| `customer-personal-data` | red | 21,164 | 3,575 | 98.5% | 16.6% | 28.5% | 27.9% | – |

## Per label: gretel-pii-finance

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `secrets` | red | 182 | 37 | 83.8% | 17.0% | 28.3% | 25.6% | – |
| `customer-personal-data` | red | 7,929 | 1,519 | 56.2% | 10.8% | 18.1% | 16.8% | – |

\* not predicted by this model: recall is 0 by design.

## Task preservation (LLM judge)

Model `claude-sonnet-5-5`. 100 records selected, 0 scored. **Not sent:** 300 uncached requests, roughly $2.28; re-run with `--yes` to send them.

