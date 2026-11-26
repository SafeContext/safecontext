# Evaluation: `tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-mh-dev` on `dev`

- **Data:** `dev.jsonl`, sha256 `9d0981cc8333a302…`; 216 of 29,174 records (sources macrohard-offline, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval tier2:ollama:gemma4:e4b-it-q4_K_M,base=results/preds/tier1-mh-dev.jsonl --split dev --source macrohard-offline --save-predictions /private/tmp/claude-501/-Users-joethompson-github-safecontext--claude-worktrees-issue-3-hook-shapes-294057/62dd6ccb-7c98-4e3a-ab16-1fdbf3da7bc5/scratchpad/diag2/t2-w152-dev.jsonl`
- **Date:** 2026-11-26 00:47 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- ⚠️ tier 2 (ollama:gemma4:e4b-it-q4_K_M): 130 calls, 324 spans judged, 4 cleared, 0 kept because the call failed
- ⚠️ tier 2 latency per call: p50 522 ms, p95 1532 ms, max 1673 ms; mean output 65 tokens

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline |
| --- | ---: | ---: |
| Records | 216 | 216 |
| Gold spans | 560 | 560 |
| Predicted spans | 555 | 555 |
| **Red recall** (target ≥ 95%) | 94.0% ❌ | 94.0% ❌ |
| Red recall, any label | 94.0% | 94.0% |
| Micro precision | 96.8% | 96.8% |
| Micro recall | 95.9% | 95.9% |
| Micro F1 | 96.3% | 96.3% |
| **Safe text flagged** (FP rate) | 12.0% (9/75) | 12.0% (9/75) |
| **Hard negatives flagged** | 12.6% (12/95) | 12.6% (12/95) |
| Latency p50 (ms) | 409 | 409 |
| Latency p95 (ms) | 1470 | 1470 |
| Mean chars / record | 176 | 176 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 77 | 64 | 100.0% | 83.1% | 90.8% | 90.8% | – |
| `internal-metrics` | yellow | 87 | 93 | 93.5% | 100.0% | 96.7% | 96.7% | 0.0% (0/25) |
| `deal-sizes` | yellow | 95 | 95 | 100.0% | 100.0% | 100.0% | 100.0% | – |
| `customer-names` | yellow | 135 | 135 | 100.0% | 100.0% | 100.0% | 100.0% | – |
| `unreleased-roadmap` | red | 68 | 68 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% (0/22) |
| `secrets` | red | 78 | 71 | 95.8% | 87.2% | 91.3% | 68.5% | 6.7% (3/45) |
| `customer-personal-data` | red | 20 | 29 | 69.0% | 100.0% | 81.6% | 81.6% | 13.4% (9/67) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 77 | 64 | 100.0% | 83.1% | 90.8% | 90.8% | – |
| `internal-metrics` | yellow | 87 | 93 | 93.5% | 100.0% | 96.7% | 96.7% | 0.0% (0/25) |
| `deal-sizes` | yellow | 95 | 95 | 100.0% | 100.0% | 100.0% | 100.0% | – |
| `customer-names` | yellow | 135 | 135 | 100.0% | 100.0% | 100.0% | 100.0% | – |
| `unreleased-roadmap` | red | 68 | 68 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% (0/22) |
| `secrets` | red | 78 | 71 | 95.8% | 87.2% | 91.3% | 68.5% | 6.7% (3/45) |
| `customer-personal-data` | red | 20 | 29 | 69.0% | 100.0% | 81.6% | 81.6% | 13.4% (9/67) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
