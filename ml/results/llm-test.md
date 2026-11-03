# Realistic test documents (`llm-test`): tiers 1 and 2 (issue #76)

The template Macrohard test data (`macrohard-offline`, 205 test records) gave the business-label
scores in [`tier1-gliner.md`](tier1-gliner.md) and [`tier2-llm.md`](tier2-llm.md). Those scores
were an upper bound: the templates have little variety. `llm-test` is 99 documents that
Claude wrote. On them, **tier 1 does much worse than on the templates**, and most of the gap is
not something tier 2 can fix.

## The set

- **Generation:** one approved run, `uv run python -m safecontext_ml.dataset llm --n-per-genre 10
  --backend claude-cli` (10 scenarios × 10 genres = 100 `claude -p` calls on Joe's Claude Code
  login, no API spend). Model `claude-sonnet-5-5`, effort `medium` (the generator's documented
  defaults). Responses are cached in `data/raw/llm-cache/claude-cli/`.
- **Built from the cache** with
  `dataset llm --n-per-genre 10 --backend claude-cli --repair-untagged --out data/llm-test/llm-test.jsonl`
  (no calls). `--out` keeps it out of `data/sources/`, so `build` never merges it and the frozen
  test split stays `1aec53bb6700782d…`.
- **99 kept, 1 rejected** (an empty `<customer-personal-data>` tag). 47 hard negatives (all 30
  press releases, release notes and public docs, plus 17 safe business documents), 52 documents
  with 670 gold spans. Median 1,312 characters (templates: 221).
- **Repair.** With the original gate, 31 of 100 responses were rejected: 30 because Claude left
  a value we gave it untagged, usually the first mention of a codename or customer in a heading
  or list ("# Project Meridian: Internal Launch Review", "1. Granite Peak Pharma (Enterprise,
  Stage 4)"). Only documents with sensitive data can fail that check, so the strict set would
  have kept 22 of 53 positive documents. `--repair-untagged` tags every whole-word occurrence
  of a value we gave the model with the label we gave it: 65 spans in 29 records. A sample of
  them read correctly in context. Values the model invented itself and left untagged can't be
  detected this way.
- **Entity pools.** Values come from the pools of the scenario's split (`meta.pools`): 74
  records use train-pool names (which tier 1 may have seen in training), 25 use dev/test pools.
  Recall on the 25 unseen-pool records is the same (customer names 100%, roadmap 34.5%,
  personal data 97.7%), so we found no sign that seen names inflate the scores.
- sha256 `f525da3f4b92dc49a172bb4de85ecfb2a165a517dd6b4d3be7331ba569ea7627`. Hosted as `data-llm`
  (`SafeContext/safecontext-data`, `llm-test/`), pinned in `models.lock.json`.

On `llm-test`, the hard negatives are whole safe documents (`negative_for` = every label), so
*Hard negatives flagged* = *Safe docs flagged* there. On the templates, a hard negative is a
look-alike for specific labels.

## Context judgement: tier 1, then tier 1 + Gemma

Tier 1 = the fine-tuned GLiNER ONNX export at threshold 0.6, as the agent runs it
(`gliner:models/tier1-onnx,device=onnx`). Tier 2 = `gemma4:e4b-it-q4_K_M` on Ollama
(`OLLAMA_CONTEXT_LENGTH=8192`), prompts v1, which judges the roadmap, revenue, metric and deal
spans.

| Set | | Red recall | Micro F1 | Safe docs flagged | Hard negatives flagged | Roadmap precision | Roadmap recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| templates (205) | tier 1 | 91.5% | 91.0% | 14/61 (23.0%) | 27/79 (34.2%) | 78.7% | 87.3% |
| templates (205) | + Gemma | 91.5% | 92.8% | 1/61 (1.6%) | 1/79 (1.3%) | 98.6% | 87.3% |
| **llm-test (99)** | tier 1 | **73.2%** | **60.3%** | **39/47 (83.0%)** | 39/47 (83.0%) | 86.4% | **33.6%** |
| **llm-test (99)** | + Gemma | 73.2% | 60.6% | 39/47 (83.0%) | 39/47 (83.0%) | 97.4% | 33.6% |
| llm-test, staff handles removed* | tier 1 | 73.2% | 80.0% | 24/47 (51.1%) | 24/47 (51.1%) | | |
| llm-test, staff handles removed* | + Gemma | 73.2% | 80.5% | 24/47 (51.1%) | 24/47 (51.1%) | | |

\* Diagnostic only: predictions whose text is exactly a Macrohard staff handle (`priya`,
`dan`, `tom.h`…, in any case) were removed before scoring (402 predictions).

Recall per label, tier 1 (templates → llm-test):

| Label | Templates recall | llm-test recall | llm-test precision |
| --- | ---: | ---: | ---: |
| `revenue-figures` | 98.4% | 76.1% | 85.4% |
| `internal-metrics` | 100.0% | 67.3% | 93.7% |
| `deal-sizes` | 68.0% | 41.7% | 100.0% |
| `customer-names` | 100.0% | 99.1% | 99.1% |
| `unreleased-roadmap` | 87.3% | **33.6%** | 86.4% |
| `secrets` | 59.2% | 79.3% | 90.2% |
| `customer-personal-data` | 97.2% | 99.4% | **26.0%** |

What goes wrong:

1. **Staff handles flagged as personal data.** 392 of the 447 wrong `customer-personal-data`
   spans are Macrohard staff handles in chat lines and attendee lists (`dan` 80, `priya` 76,
   `sasha` 54…). The rest are mostly company and example addresses (`support@macrohard.io`,
   `press@example.com`). This is the known mismatch in `ml/README.md`: the public PII sets label
   every person name, while Macrohard leaves staff unlabelled. Tier 2 doesn't judge personal
   data, so it can't help. This makes 83% of safe documents flagged; without it, 51%.
2. **Codenames missed.** Roadmap recall is 33.6%: one-word codenames in running text ("Quasar",
   "Heron", "Petrel") and planned dates ("March 2027", "Q1 2027") are mostly not found. Tier 2
   only removes spans, so it can't raise recall.
3. **Business numbers missed or mislabelled.** Deal sizes in prose ("$412,000 annually") are
   often missed or called revenue. Metrics with less usual units ("47 minutes", "1,900 msg/s",
   "498 of 500") are often missed.
4. **Connection strings** with passwords in them are 9 of the 12 missed secrets.

**Tier 2 still works as designed.** Gemma made 42 calls, judged 194 spans and cleared 7. All 7
were false positives (roadmap precision 86.4% → 97.4%), and it cleared no true span, so red
recall didn't change. It had less to clear than on the templates: tier 1 flagged no
roadmap-type span in any of the 47 llm-test hard negatives. Per-call latency was p50 1.3 s and
p95 2.5 s (templates: 0.5 / 1.1 s), because the documents are about 6 times longer.

Tier 1 latency (ONNX, CPU, one document at a time): p50 106 ms and p95 283 ms (templates: 20 /
37 ms), again because of the longer documents.

## Generalize

The gold revenue, metric and deal spans: 228 values in 42 records (templates: 250 in 83).

| Set | Model | Clean | Leak | Too precise | True (of checkable) | Checkable |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| templates | rule rewrite | 100.0% | 0.0% | 0.0% | 100.0% | 100.0% |
| templates | Gemma 4 E4B | 77.2% | 0.4% | 12.4% | 89.8% | 98.0% |
| **llm-test** | rule rewrite | **96.5%** | 0.0% | 0.0% | 100.0% | 96.5% |
| **llm-test** | Gemma 4 E4B | **81.1%** | 1.3% | 8.3% | 89.9% | 91.2% |

- The rule rewrite gave no answer for 8 values in formats it doesn't parse: durations ("47
  minutes", "94 minutes", "4 days", "30 months"), a rate ("1,900 msg/s"), a ratio ("498 of 500")
  and a unit price ("$38 per seat per month"). In the agent, these would fall back to the
  `[Data type name]` placeholder. Every answer it gave was true and leak-free.
- Gemma's results are about the same as on the templates. Its rewrites leaked 3 values.
- **Values without numbers** (customer names and roadmap values, 227 values in 52 records,
  Gemma): 0 leaks, all in format (templates: 309 values, 0 leaks). Whether they are true still
  needs the Claude judge, which wasn't run.

## What this means

- The template scores overstated tier 1 on business data. On realistic text it misses most
  unreleased codenames and dates (red recall 73% against the 95% target), and it flags nearly
  every internal chat because of staff names.
- The next steps are tier 1 work, not tier 2: deciding how names are labelled (README *Known
  mismatch*, an open decision for #2), and training on realistic Macrohard text (for example
  more `dataset llm` documents in the train split, on a separate approval).
- 99 documents is small. Treat differences of a few points as noise.

Per-run reports:
[`gliner-tier1-onnx-export-t0.6-onnx-llm-test.md`](gliner-tier1-onnx-export-t0.6-onnx-llm-test.md),
[`tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-llm-test-llm-test.md`](tier2-ollama-gemma4-e4b-it-q4_K_M-on-tier1-llm-test-llm-test.md),
[`tier2-generalize-rules-llm-test.md`](tier2-generalize-rules-llm-test.md),
[`tier2-generalize-ollama-gemma4-e4b-it-q4_K_M-llm-test.md`](tier2-generalize-ollama-gemma4-e4b-it-q4_K_M-llm-test.md).
