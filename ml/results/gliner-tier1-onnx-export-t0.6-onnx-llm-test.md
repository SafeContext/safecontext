# Evaluation: `gliner-tier1-onnx-export-t0.6-onnx` on `llm-test`

- **Data:** `llm-test.jsonl`, sha256 `b76f9971fd004c03…`; 99 of 99 records (all records)
- **Command:** `uv run python -m safecontext_ml.eval gliner:models/tier1-onnx,device=onnx --split llm-test --save-predictions results/preds/v2-tier1-llm-test.jsonl`
- **Date:** 2026-11-04 03:05 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-llm |
| --- | ---: | ---: |
| Records | 99 | 99 |
| Gold spans | 624 | 624 |
| Predicted spans | 522 | 522 |
| **Red recall** (target ≥ 95%) | 74.8% ❌ | 74.8% ❌ |
| Red recall, any label | 75.2% | 75.2% |
| Micro precision | 89.7% | 89.7% |
| Micro recall | 75.0% | 75.0% |
| Micro F1 | 81.7% | 81.7% |
| **Safe text flagged** (FP rate) | 38.3% (18/47) | 38.3% (18/47) |
| **Hard negatives flagged** | 38.3% (18/47) | 38.3% (18/47) |
| Latency p50 (ms) | 109 | 109 |
| Latency p95 (ms) | 295 | 295 |
| Mean chars / record | 1,345 | 1,345 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 46 | 89.1% | 89.1% | 89.1% | 89.1% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 67 | 95.5% | 58.2% | 72.3% | 72.3% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 39 | 100.0% | 54.2% | 70.3% | 70.3% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 116 | 97.4% | 99.1% | 98.3% | 98.3% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 58 | 89.7% | 46.0% | 60.8% | 60.8% | 0.0% (0/47) |
| `secrets` | red | 58 | 52 | 92.3% | 82.8% | 87.3% | 67.3% | 6.4% (3/47) |
| `customer-personal-data` | red | 111 | 144 | 77.1% | 100.0% | 87.1% | 83.9% | 34.0% (16/47) |

## Per label: macrohard-llm

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 46 | 46 | 89.1% | 89.1% | 89.1% | 89.1% | 0.0% (0/47) |
| `internal-metrics` | yellow | 110 | 67 | 95.5% | 58.2% | 72.3% | 72.3% | 0.0% (0/47) |
| `deal-sizes` | yellow | 72 | 39 | 100.0% | 54.2% | 70.3% | 70.3% | 0.0% (0/47) |
| `customer-names` | yellow | 114 | 116 | 97.4% | 99.1% | 98.3% | 98.3% | 0.0% (0/47) |
| `unreleased-roadmap` | red | 113 | 58 | 89.7% | 46.0% | 60.8% | 60.8% | 0.0% (0/47) |
| `secrets` | red | 58 | 52 | 92.3% | 82.8% | 87.3% | 67.3% | 6.4% (3/47) |
| `customer-personal-data` | red | 111 | 144 | 77.1% | 100.0% | 87.1% | 83.9% | 34.0% (16/47) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
