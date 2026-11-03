# Tier 2 small LLM: candidates, scores and the chosen model (issue #14)

**Chosen:** **Gemma 4 E4B instruct** (`gemma4:e4b-it-q4_K_M`, Apache-2.0) on **Ollama**,
Q4_K_M quantisation, server started with `OLLAMA_CONTEXT_LENGTH=8192`. Pinned in
[`models.lock.json`](../models.lock.json) under `external` (`tier2-llm`, with the MLX build as
`tier2-llm-mlx`). Prompts: [`prompts/tier2/`](../prompts/tier2/) (version 1).

- **Context judgement** (tier 1 spans of roadmap / revenue / metrics / deal types, test split,
  Macrohard): roadmap-vs-press-release hard negatives flagged **52% → 0%** (26/50 → 0/50); safe
  documents flagged **23.0% → 1.6%**; all hard negatives flagged **34.2% → 1.3%**; red recall
  **unchanged at 91.5%** (no true span cleared).
- **Speed** on an M3 Max: p50 **0.5 s**, p95 **1.1-1.3 s** per call; cold start 5-6 s.
  Estimated base 16 GB Mac: p50 ~2 s, p95 ~4-5 s. Fastest of the six candidates, because the
  Ollama build ships a draft model for speculative decoding.
- **Memory:** **7.1 GB** resident at an 8k context (7.5 GB at Ollama's default 32k). The largest
  of the small models; see *16 GB Macs* (a decision for the team).
- **Generalize:** no small model is reliable enough with numbers (best: 77-82% of rewrites
  pass every check). A deterministic rewrite (`rule_rewrite`, "over $4M", "high teens") passes
  100% and takes no time. **Recommendation: numbers use the deterministic rewrite; the LLM
  rewrites only values without a number** (names, codenames, dates), where Gemma leaked nothing
  in 309 values.

No fine-tuning: prompting got context judgement to 0 wrong clears on test, and the part
prompting can't do (exact numeric buckets) is solved better without a model.

## Candidates

All instruct models current on the Ollama library on 2026-11-02, Q4_K_M. Licences from the
Hugging Face API (`cardData.license`) and the Ollama manifest.

| Model | Ollama tag | Params | Disk | Licence | Upstream (HF) |
| --- | --- | ---: | ---: | --- | --- |
| Qwen3.5 2B | `qwen3.5:2b-q4_K_M` | 1.9B | 1.9 GB | Apache-2.0 | `Qwen/Qwen3.5-2B` |
| Qwen3.5 4B | `qwen3.5:4b-q4_K_M` | 4.2B | 3.3 GB | Apache-2.0 | `Qwen/Qwen3.5-4B` |
| Granite 4.2 3B | `granite4.2:3b` | 3.7B | 2.2 GB | Apache-2.0 | `ibm-granite/granite-4.2-3b` |
| **Gemma 4 E4B** | `gemma4:e4b-it-q4_K_M` | 7.5B total, 4B effective | 6.6 GB | Apache-2.0 | `google/gemma-4-e4b-it` |
| Granite 4.2 8B | `granite4.2:8b` | 8.8B | 5.3 GB | Apache-2.0 | `ibm-granite/granite-4.2-8b` |
| Qwen3.5 9B | `qwen3.5:9b-q4_K_M` | 9.0B | 6.6 GB | Apache-2.0 | `Qwen/Qwen3.5-9B` |

Considered, not downloaded: **Phi-4-mini** 3.8B (MIT, Feb 2025; no newer small Phi exists, and the
four newer families above cover its size), **Llama 3.1 8B / 3.2 3B** (Llama community licence,
not permissive; no 2026 small Llama), Gemma 4 12B (over the ~8B cap). MLX builds were benchmarked
for the two finalists: `mlx-community/gemma-4-e4b-it-4bit` and `mlx-community/Qwen3.5-4B-MLX-4bit`.

## Context judgement (tier 1 + tier 2)

Tier 1 = the GLiNER ONNX export (`gliner:models/tier1-onnx,device=onnx`) on the 205 Macrohard
test records; tier 2 then judges its roadmap / revenue / metrics / deal spans (one call per
document) and drops the ones it calls not sensitive. A failed call keeps the spans. The public
PII sources have none of these labels, so tier 2 leaves them (and their scores) unchanged.
Prompts were tuned on `dev` only; `test` was run once per model with the final prompts.

**Test (Macrohard, 205 records, 79 hard negatives):**

| Model | Red recall | Micro F1 | Safe docs flagged | Hard negatives flagged | Roadmap hard neg. | Roadmap precision | Roadmap recall | Calls failed (6 s cap) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tier 1 only | 91.5% | 91.0% | 14/61 (23.0%) | 27/79 (34.2%) | 26/50 | 78.7% | 87.3% | – |
| **+ Gemma 4 E4B** | **91.5%** | **92.8%** | **1/61 (1.6%)** | **1/79 (1.3%)** | **0/50** | 98.6% | **87.3%** | 0 |
| + Qwen3.5 4B | 91.3% | 92.8% | 1/61 (1.6%) | 1/79 (1.3%) | 0/50 | 100.0% | 86.6% | 0 |
| + Qwen3.5 2B | 91.5% | 91.9% | 7/61 (11.5%) | 9/79 (11.4%) | 8/50 | 90.7% | 87.3% | 0 |
| + Granite 4.2 3B | 91.5% | 92.5% | 4/61 (6.6%) | 4/79 (5.1%) | 3/50 | 94.5% | 87.3% | 0 |
| + Granite 4.2 8B | 91.5% | 92.6% | 2/61 (3.3%) | 2/79 (2.5%) | 1/50 | 97.2% | 87.3% | 3 |
| + Qwen3.5 9B | 91.5% | 92.7% | 2/61 (3.3%) | 2/79 (2.5%) | 1/50 | 97.2% | 87.3% | 24 |

- Gemma cleared 39 spans and none of them was a gold span. Qwen3.5 4B cleared one real roadmap
  span (red recall -0.2 points). Qwen3.5 2B also cleared real revenue spans (revenue recall
  98.4% → 85.7%).
- The 8-9B models are no better here and too slow: at the 6 s per-call cap, Qwen3.5 9B timed out
  on 24 of 109 calls (their spans were kept, which flatters its numbers).
- Revenue precision stays at 71.3% for every model: those false positives are deal sizes that
  tier 1 labelled as revenue. They are sensitive, just under the wrong type, so tier 2 rightly
  keeps them (it judges sensitivity, not the label).
- Red recall stays below the 95% target because of tier 1's misses on Macrohard (long secrets,
  see `tier1-gliner.md`); tier 2 only removes spans, so it can't raise recall.

On `dev` (216 records) every model except Granite 3B gave the same result (safe docs flagged
21.3% → 8.0%, hard negatives 20.0% → 9.5%, roadmap hard negatives 10/22 → 0/22, red recall
unchanged at 92.1%): the dev hard negatives are easier. One dev change was needed: the first
prompt cleared an unlabelled internal ARR figure, so the system prompt now says company data is
private unless the document shows otherwise.

Per-run reports: [`tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-mh-test-test-sample.md`](tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-mh-test-test-sample.md).

## Generalize

Input: the gold spans of the three generalize types (revenue, metrics, deals) in Macrohard test
records, 250 values in 83 records, one call per record. Checks (no Claude): answered with valid
JSON; format (one line, ≤ 6 words, ≤ 60 characters, no markup); **leak** (the value repeated in
any form); **too precise** (a number with 2+ significant digits within 5% of the value, e.g.
"about $3.4M" for $3,402,000); **entity leak** (another sensitive value from the record);
**true** (the interval the wording claims, e.g. "high teens" = 16-20%, "low six figures" =
$100k-$400k, contains the value; "checkable" = the heuristic understood the wording). *Clean* =
all checks pass.

**Test:**

| Model | Clean | Leak | Too precise | True (of checkable) | Checkable | p50 ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **deterministic `rule_rewrite`** | **100.0%** | 0.0% | 0.0% | 100.0% | 100.0% | 0 | 0 |
| Qwen3.5 4B | 81.6% | 0.0% | 5.6% | 86.8% | 96.8% | 2016 | 2263 |
| **Gemma 4 E4B** | 77.2% | 0.4% | 12.4% | 89.8% | 98.0% | 818 | 973 |
| Qwen3.5 9B | 65.6% | 3.2% | 26.0% | 94.8% | 99.2% | 3315 | 3800 |
| Granite 4.2 8B | 63.6% | 2.0% | 22.8% | 88.1% | 97.2% | 1812 | 2326 |
| Granite 4.2 3B | 60.4% | 4.0% | 10.8% | 68.5% | 78.8% | 1291 | 1645 |
| Qwen3.5 2B | 49.6% | 0.4% | 8.0% | 58.1% | 99.2% | 895 | 1097 |

Typical model errors: "a few million dollars" for $1.8M (false), "high eighties" for 83.3%
(false), "about $22M" for $21.7M (too precise), "low six figures" for $3.5M (wrong magnitude).
Bigger models are *less* vague (more "too precise"), not more correct. The deterministic rewrite
is true by construction and the checks agree with it: it uses the same intervals, so read its
100% as "it does what the checks ask", not as an independent score.

**Values without numbers** (`customer-names` and `unreleased-roadmap`, 309 test values, Gemma):
0 leaks of the name, codename or date, all in format, p50 0.5 s. Truth can't be checked
mechanically, and some rewrites copy the few-shot wording ("Bluefin Foods" → "a logistics
customer"), so these need the Claude judge before relying on them.

Reports: [`tier2-generalize-ollama-gemma4-e4b-it-q4_K_M-test.md`](tier2-generalize-ollama-gemma4-e4b-it-q4_K_M-test.md),
[`tier2-generalize-rules-test.md`](tier2-generalize-rules-test.md).

### Task preservation (Claude judge): ready, not run

Through the local Claude Code CLI (`--judge-backend claude-cli`, no API spend). Dry-run counts
(3 `claude -p` calls per record: answer on the original, answer on the cleaned text, judge):

| Run | Records | `claude -p` calls |
| --- | ---: | ---: |
| Context judgement: `eval tier2:...,base=... --split test --source macrohard-offline --judge 30 --judge-backend claude-cli` | 30 | 90 |
| Generalize, Gemma: `tier2 generalize ollama:gemma4:e4b-it-q4_K_M --split test --judge 30` | 30 | 90 |
| Generalize, rules: `tier2 generalize rules --split test --judge 30` | 30 | 90 (60 if run after the Gemma one: the 30 answers on the original text are cached and shared) |

Add `--yes` only after the OK. Model: `claude-sonnet-5-5` (`--judge-model`).

## Speed and memory

`python -m safecontext_ml.tier2 bench`: 40 context calls and 40 generalize calls on fixed dev
records, one at a time; Apple M3 Max (16-core CPU, 40-core GPU, 400 GB/s), 48 GB, macOS 26,
Ollama 0.40.13, mlx-lm 0.32.2. Cold start = model not in memory → first answer (weights likely in
the OS file cache). Peak RAM = highest RSS of the model's process (it includes the memory-mapped
weights). Ollama runs used its default 32k context unless marked 8k.

| Model | Runtime | Cold start | Context p50 / p95 | Generalize p50 / p95 | Peak RAM | Prefill / decode tok/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **Gemma 4 E4B** | Ollama, 8k ctx | 6.1 s | **0.48 / 1.11 s** | 0.38 / 0.82 s | **7.1 GB** | 7,900 / 136 |
| Gemma 4 E4B | Ollama | 5.2 s | 0.53 / 1.29 s | 0.42 / 0.91 s | 7.5 GB | 6,200 / 125 |
| Gemma 4 E4B | MLX (`mlx_lm.server`) | 11.7 s | 1.24 / 2.33 s | 1.24 / 1.92 s | 4.8 GB | – |
| Qwen3.5 4B | Ollama, 8k ctx | 4.3 s | 1.21 / 2.24 s | 1.05 / 1.77 s | 4.2 GB | 1,900 / 79 |
| Qwen3.5 4B | Ollama | 4.5 s | 1.46 / 2.71 s | 1.30 / 2.19 s | 4.9 GB | 1,600 / 61 |
| Qwen3.5 4B | MLX | 8.8 s | 1.64 / 2.46 s | 1.67 / 2.28 s | 3.0 GB | – |
| Qwen3.5 2B | Ollama | 2.8 s | 0.70 / 1.45 s | 0.58 / 1.09 s | 2.7 GB | 3,800 / 112 |
| Granite 4.2 3B | Ollama | 4.5 s | 0.81 / 2.18 s | 0.41 / 1.62 s | 5.0 GB | 8,900 / 85 |
| Granite 4.2 8B | Ollama | 8.1 s | 1.10 / 2.97 s | 0.86 / 2.17 s | 10.6 GB | 4,000 / 41 |
| Qwen3.5 9B | Ollama | 8.3 s | 2.48 / 4.42 s | 2.36 / 3.75 s | 8.0 GB | 900 / 36 |

- **Ollama vs MLX:** Ollama was 1.1-2.6x faster at p50 for both finalists, has constrained
  JSON output (MLX's server ignores `response_format`: 2 of 80 Gemma answers were invalid JSON),
  and starts faster. MLX used less RAM (it loads only the text model). Ollama stays the default.
- Every request repeats the same ~1,500-token system prompt + few-shot prefix; Ollama reuses it
  from its prompt cache, so a call mostly costs the ~60-100 answer tokens.
- An 8k context is plenty (a 4,000-character excerpt + prompt is ~3k tokens) and saves
  0.4-0.8 GB.

### Base 16 GB M-series Mac (estimated, not measured)

Generation is memory-bandwidth bound and prompt processing is GPU-compute bound, so the M3 Max
figures were scaled by the hardware ratios to a base M3/M4 (100-120 GB/s, 10-core GPU): decode
time ×3.3-4, prefill time ×4. Since both parts scale by roughly the same factor, the per-call
latency is scaled by ×3.5-4. RAM does not depend on the chip, so the measured RSS is used as is.

| Model | Est. p50 | Est. p95 | Fits the 6 s per-call cap? | RAM | Share of 16 GB |
| --- | ---: | ---: | --- | ---: | ---: |
| **Gemma 4 E4B** (Ollama, 8k) | ~1.7-2 s | ~4-4.5 s | yes | 7.1 GB | 44% |
| Qwen3.5 4B (Ollama, 8k) | ~4.2-4.8 s | ~8-9 s | **no** at p95 | 4.2 GB | 26% |
| Qwen3.5 2B (Ollama) | ~2.5-2.8 s | ~5-6 s | borderline | 2.7 GB | 17% |

### 16 GB Macs (needs a decision)

Gemma's 7.1 GB is the cost of its speed and quality. macOS lets the GPU use about two thirds of
RAM (~10.7 GB on 16 GB), so it fits, but with Claude Code, an IDE and a browser open, a 16 GB Mac
will be under memory pressure. Options: accept it; offer Qwen3.5 2B on 16 GB Macs (2.7 GB, but
roadmap hard negatives 16% flagged and weaker revenue recall); or try Gemma's QAT build
(`gemma4:e4b-it-qat`, 6.1 GB on disk, not tested here). Tier 2 is also only needed when tiers
0/1 find a context-dependent span, and Ollama unloads an idle model after `keep_alive`
(default 5 min), so memory is only held while it is in use.

## Reproduce

```bash
cd ml
brew install ollama && OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_FLASH_ATTENTION=1 ollama serve &
ollama pull gemma4:e4b-it-q4_K_M
# tier 1 spans to judge (macrohard records only)
uv run python -m safecontext_ml.eval gliner:models/tier1-onnx,device=onnx --split test \
    --source macrohard-offline --save-predictions results/preds/tier1-mh-test.jsonl --no-save
# context judgement on top of them
uv run python -m safecontext_ml.eval tier2:ollama:gemma4:e4b-it-q4_K_M,base=results/preds/tier1-mh-test.jsonl \
    --split test --source macrohard-offline
# generalize, and the deterministic baseline
uv run python -m safecontext_ml.tier2 generalize ollama:gemma4:e4b-it-q4_K_M --split test
uv run python -m safecontext_ml.tier2 generalize rules --split test
# speed and memory
uv run python -m safecontext_ml.tier2 bench ollama:gemma4:e4b-it-q4_K_M mlx:mlx-community/gemma-4-e4b-it-4bit
```

## Caveats

- **Macrohard is templated** (offline backend only), so these hard negatives are easier and
  more uniform than real text; treat the context scores as an upper bound. A small
  `dataset llm --backend claude-cli` run (`--n-per-genre 10` = 100 `claude -p` calls, 47 hard
  negatives, 12 test documents) would add varied ones once approved.
- The truth heuristic understands common English vague phrases (decades, "N figures", "a few
  million", fractions, over/under/about N); number words ("thirty-five percent") count as
  "unverified".
- Latency is per call with one call at a time. Concurrent hook calls queue on one Ollama model.
- The 16 GB numbers are estimates; measure on a real base Mac before deciding.
