# Evaluation: `tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-mh-test` on `test`

- **Data:** `test.jsonl`, sha256 `dfe667ab75ef91b0…`; 205 of 29,018 records (sources macrohard-offline, seed 0)
- **Command:** `uv run python -m safecontext_ml.eval tier2:ollama:gemma4:e4b-it-q4_K_M,base=results/preds/tier1-mh-test.jsonl --split test --source macrohard-offline --save-predictions /private/tmp/claude-501/-Users-joethompson-github-safecontext--claude-worktrees-issue-3-hook-shapes-294057/62dd6ccb-7c98-4e3a-ab16-1fdbf3da7bc5/scratchpad/diag2/t2-w152-test.jsonl`
- **Date:** 2026-11-26 00:48 UTC · **Machine:** Apple M3 Max, 16 cores, Darwin 25.6.0, Python 3.14.7
- **Latency:** wall-clock per `predict()` call, one document at a time, after 3 warm-up calls
- **Matching:** overlap, same label (exact (start, end, label) in the *Exact F1* column); predictions that only touch `ignore` regions are dropped. Rules: `ml/README.md`, Evaluation.
- ⚠️ tier 2 (ollama:gemma4:e4b-it-q4_K_M): 102 calls, 400 spans judged, 28 cleared, 0 kept because the call failed
- ⚠️ tier 2 latency per call: p50 948 ms, p95 1893 ms, max 2229 ms; mean output 99 tokens

Public PII (Nemotron, Gretel) carries only `customer-personal-data` and `secrets`; the five business labels come only from Macrohard, so read the per-source columns.

## Headline

| Metric | overall | macrohard-offline |
| --- | ---: | ---: |
| Records | 205 | 205 |
| Gold spans | 849 | 849 |
| Predicted spans | 794 | 794 |
| **Red recall** (target ≥ 95%) | 89.9% ❌ | 89.9% ❌ |
| Red recall, any label | 90.6% | 90.6% |
| Micro precision | 95.8% | 95.8% |
| Micro recall | 89.6% | 89.6% |
| Micro F1 | 92.6% | 92.6% |
| **Safe text flagged** (FP rate) | 3.3% (2/61) | 3.3% (2/61) |
| **Hard negatives flagged** | 1.3% (1/79) | 1.3% (1/79) |
| Latency p50 (ms) | 0.02 | 0.02 |
| Latency p95 (ms) | 1829 | 1829 |
| Mean chars / record | 221 | 221 |
| Predictions dropped (ignore regions) | 0 | 0 |

## Per label, all sources

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 61 | 100.0% | 93.8% | 96.8% | 96.8% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 87 | 96.6% | 68.9% | 80.4% | 80.4% | – |
| `customer-names` | yellow | 152 | 156 | 97.4% | 100.0% | 98.7% | 98.7% | – |
| `unreleased-roadmap` | red | 157 | 137 | 100.0% | 87.3% | 93.2% | 93.2% | 0.0% (0/50) |
| `secrets` | red | 49 | 25 | 100.0% | 51.0% | 67.6% | 48.6% | 0.0% (0/25) |
| `customer-personal-data` | red | 241 | 241 | 99.6% | 99.6% | 99.6% | 92.5% | 16.7% (1/6) |

## Per label: macrohard-offline

| Label | Tier | Gold | Pred | Precision | Recall | F1 | Exact F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 87 | 71.3% | 98.4% | 82.7% | 82.7% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 61 | 100.0% | 93.8% | 96.8% | 96.8% | 0.0% (0/38) |
| `deal-sizes` | yellow | 122 | 87 | 96.6% | 68.9% | 80.4% | 80.4% | – |
| `customer-names` | yellow | 152 | 156 | 97.4% | 100.0% | 98.7% | 98.7% | – |
| `unreleased-roadmap` | red | 157 | 137 | 100.0% | 87.3% | 93.2% | 93.2% | 0.0% (0/50) |
| `secrets` | red | 49 | 25 | 100.0% | 51.0% | 67.6% | 48.6% | 0.0% (0/25) |
| `customer-personal-data` | red | 241 | 241 | 99.6% | 99.6% | 99.6% | 92.5% | 16.7% (1/6) |

## Task preservation (LLM judge)

Not run. It is opt-in: `--judge N` picks N records the model changed and prints how many requests it would send; add `--yes` to send them. `--judge-backend claude-cli` uses the local `claude -p` (no API spend).
