# Evaluation: `gliner-tier1-onnx-export-t0.6-onnx` (retrained with staff-names, #78; not shipped) on `llm-test`

- **Data:** `llm-test.jsonl`, sha256 `f406ecd46d83a37f…`; 99 of 99 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval gliner:models/tier1-onnx,device=onnx --split llm-test --save-predictions results/preds/new-tier1-llm-test.jsonl`
- **Date:** 2026-11-04 01:00 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- **Sensitive labels:** micro scores and *Safe text flagged* use the yellow and red labels only. `staff-names` is green by default, so it has its own row below and doesn't flag a document.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels and `staff-names` come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-llm |
| --- | ---: | ---: |
| Records | 99 | 99 |
| Gold spans | 1,307 | 1,307 |
| Predicted spans | 1,190 | 1,190 |
| **Red recall** (target ≥ 95%) | 78.7% ❌ | 78.7% ❌ |
| Red recall, any label | 79.0% | 79.0% |
| Micro precision | 55.2% | 55.2% |
| Micro recall | 79.7% | 79.7% |
| Micro F1 | 65.2% | 65.2% |
| **Safe text flagged** (FP rate) | 83.0% (39/47) | 83.0% (39/47) |
| **Hard negatives flagged** | 83.0% (39/47) | 83.0% (39/47) |
| Latency p50 (ms) | 107 | 107 |
| Latency p95 (ms) | 290 | 290 |
| Mean chars / record | 1,345 | 1,345 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `staff-names` | green | 637 | 221 | 100.0% | 34.7% | 51.5% | 51.5% | – |
| `revenue-figures` | yellow | 46 | 53 | 81.1% | 93.5% | 86.9% | 86.9% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 97 | 88.7% | 78.2% | 83.1% | 83.1% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 33 | 100.0% | 45.8% | 62.9% | 62.9% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 116 | 98.3% | 100.0% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 70 | 85.7% | 53.1% | 65.6% | 64.5% | 0.0% (0/47) |
| `secrets` | red | 58 | 49 | 83.7% | 70.7% | 76.6% | 69.2% | 14.9% (7/47) |
| `customer-personal-data` | red | 157 | 551 | 28.7% | 100.0% | 44.6% | 42.7% | 76.6% (36/47) |

## Per label: macrohard-llm

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `staff-names` | green | 637 | 221 | 100.0% | 34.7% | 51.5% | 51.5% | – |
| `revenue-figures` | yellow | 46 | 53 | 81.1% | 93.5% | 86.9% | 86.9% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 97 | 88.7% | 78.2% | 83.1% | 83.1% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 33 | 100.0% | 45.8% | 62.9% | 62.9% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 116 | 98.3% | 100.0% | 99.1% | 99.1% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 70 | 85.7% | 53.1% | 65.6% | 64.5% | 0.0% (0/47) |
| `secrets` | red | 58 | 49 | 83.7% | 70.7% | 76.6% | 69.2% | 14.9% (7/47) |
| `customer-personal-data` | red | 157 | 551 | 28.7% | 100.0% | 44.6% | 42.7% | 76.6% (36/47) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
