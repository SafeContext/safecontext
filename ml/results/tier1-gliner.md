# Tier 1 tagger: GLiNER variants and the chosen model (issue #13)

**Chosen:** GLiNER small v2.1 (`urchade/gliner_small-v2.1`, Apache-2.0) **fine-tuned on our train
split**, with one label per data type (the data type names, lower case) and threshold **0.6**.
Exported to ONNX in the #5 spike's format, which the agent (#15) loads unchanged.

On the full frozen test split (29,018 records) it finds **97.8% of red spans** (target ≥ 95%),
micro F1 **97.7%**, and flags **8.1%** of safe records. The best off-the-shelf model (GLiNER
large, ~3x the compute, with 20 hand-picked labels the agent can't use) reached 85.1% red recall
and flagged 55.6% of safe records, so fine-tuning was needed.

Everything below was tuned on `dev` only (thresholds, prompts, checkpoint). `test` was used once
per variant for the numbers in this file. Test sha256 `1aec53bb6700782d…` (see the per-run reports).

## Variants tried

| Variant | Licence | Weights (fp32) | Architecture | Training data | Notes |
| --- | --- | ---: | --- | --- | --- |
| `urchade/gliner_small-v2.1` | Apache-2.0 | 611 MB | uni-encoder span, DeBERTa-v3-small | `urchade/pile-mistral-v0.1` | The #5 spike model |
| `urchade/gliner_medium-v2.1` | Apache-2.0 | 781 MB | uni-encoder span, DeBERTa-v3-base | same | |
| `urchade/gliner_large-v2.1` | Apache-2.0 | 1,782 MB | uni-encoder span, DeBERTa-v3-large | same | 3x the compute of small |
| `knowledgator/gliner-pii-base-v1.0` | Apache-2.0 | 664 MB | uni-encoder span, DeBERTa-v3-small size (6 layers, 768 hidden) | **Not disclosed** | PII-focused (Wordcab + Knowledgator). Undisclosed data may overlap the public PII sets we test on |
| **Fine-tuned small (chosen)** | Apache-2.0 base; our data | 611 MB | as small | small + our train split | Built by `tagger/finetune.py` |

All licences checked on the Hugging Face API (`cardData.license`) on 2026-10-27. Rejected without
scoring: `nvidia/gliner-PII` (NVIDIA licence, and trained on Nemotron-PII, which is in our test
set), `gretelai/gretel-gliner-bi-*` (trained on Gretel PII, also in our test set; bi-encoder, so
the agent can't load it), `knowledgator/gliner-pii-edge-v1.0` (ModernBERT encoder and tokenizer;
never tried with the agent's loader, and we capped the run at four variants).

## Label wording matters

The agent takes exactly **one label per data type** (`labels.json`). Off-the-shelf models do
much better with several concrete labels per type (`fine`: "email address", "phone number",
"person name"... for `customer-personal-data`) than with any single label. GLiNER small on
`dev` (300 records per source), threshold chosen per row:

| Prompt set | Labels per type | Mean per-source F1 | Red recall | Safe text flagged |
| --- | ---: | ---: | ---: | ---: |
| `names` ("customer personal data") | 1 | 12.8% | 11.3% | 69.8% |
| `entity` ("personal information", "customer name"...) | 1 | 15.9% | 18.9% | 84.3% |
| `entity2` ("person name or contact detail", "company name"...) | 1 | 38.9% | 45.7% | 75.6% |
| `fine` (20 labels) | 1-10 | 60.3% | 76.6% | 84.9% |

So off-the-shelf models are scored below with `fine` (their best case, not shippable as is) and
`entity2` (the best shippable set). The fine-tuned model learns the `names` labels and still works
with other wordings (dev: 90.3% mean F1 with `entity2`, 93.0% with `fine`, 94.4% with `names`).

## Scores on test

Threshold for each row chosen on dev: the best mean per-source micro F1 (for the fine-tuned
model: among thresholds whose dev red recall is ≥ 95%). "Sample" = at most 500 records per
source (1,705 records, seed 0). Macrohard is the only source of the five business labels.

| Variant | Prompts | Thr. | Test | Red recall | Micro F1 | Safe text flagged | Hard neg. flagged | Macrohard red recall | Macrohard F1 | Nemotron F1 | Gretel en F1 | Gretel fin. F1 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| regex baseline (#12) | – | – | full | 20.2% | 33.3% | 2.8% | 10.1% | 30.0% | 30.1% | 35.9% | 28.7% | 18.3% |
| small v2.1 | fine | 0.35 | full | 77.0% | 69.6% | 56.4% | 81.0% | 71.5% | 61.9% | 70.6% | 77.8% | 51.7% |
| small v2.1 | fine | 0.35 | sample | 74.9% | 63.8% | 75.7% | 81.0% | 71.5% | 61.9% | 67.0% | 77.0% | 51.3% |
| small v2.1 | entity2 | 0.15 | sample | 43.5% | 37.9% | 72.9% | 41.8% | 38.0% | 44.4% | 48.2% | 44.0% | 23.2% |
| medium v2.1 | fine | 0.55 | full | 75.8% | 73.0% | 44.6% | 72.2% | 76.9% | 66.2% | 74.8% | 73.3% | 60.0% |
| medium v2.1 | fine | 0.55 | sample | 74.2% | 68.1% | 58.6% | 72.2% | 76.9% | 66.2% | 72.7% | 73.4% | 59.5% |
| medium v2.1 | entity2 | 0.40 | sample | 28.9% | 31.7% | 65.7% | 31.6% | 37.0% | 47.8% | 34.7% | 20.1% | 30.2% |
| large v2.1 | fine | 0.65 | full | 85.1% | 78.4% | 55.6% | 86.1% | 87.3% | 76.7% | 80.7% | 80.0% | 59.2% |
| large v2.1 | fine | 0.65 | sample | 83.9% | 73.6% | 69.5% | 86.1% | 87.3% | 76.7% | 79.7% | 79.9% | 59.5% |
| large v2.1 | entity2 | 0.30 | sample | 47.5% | 47.7% | 75.2% | 88.6% | 50.6% | 59.7% | 52.1% | 50.0% | 35.7% |
| knowledgator pii-base | fine | 0.45 | full | 69.0% | 75.6% | 34.9% | 73.4% | 83.6% | 68.3% | 77.8% | 76.1% | 58.9% |
| knowledgator pii-base | fine | 0.45 | sample | 68.9% | 70.9% | 49.5% | 73.4% | 83.6% | 68.3% | 77.0% | 76.7% | 60.2% |
| knowledgator pii-base | entity2 | 0.30 | sample | 22.5% | 28.6% | 66.7% | 72.2% | 32.7% | 44.7% | 33.0% | 14.4% | 25.7% |
| **fine-tuned small** | names | 0.60 | **full** | **97.8%** ✅ | **97.7%** | **8.1%** | 34.2% | 91.5% | 91.0% | 98.9% | 97.5% | 86.9% |
| **fine-tuned small** | names | 0.60 | sample | 95.4% ✅ | 94.7% | 11.4% | 34.2% | 91.5% | 91.0% | 99.0% | 97.1% | 88.0% |
| fine-tuned small, **ONNX export** | names | 0.60 | sample | 95.4% ✅ | 94.7% | 11.4% | 34.2% | 91.5% | 91.0% | 99.0% | 97.1% | 88.0% |
| regex ∪ fine-tuned small | – | 0.60 | full | 97.9% | 97.5% | 9.5% | 44.3% | 94.1% | 91.4% | 98.9% | 97.4% | 84.8% |

The last row is the union of the regex baseline's and the fine-tuned model's spans: a rough
stand-in for tiers 0 + 1 (the regex baseline is **not** the TypeScript tier 0).

Per-label tables for each row are in the `predictions-*.md` / `gliner-tier1-onnx-*.md` reports
next to this file.

### The chosen model per label (full test, all sources)

| Label | Tier | Gold | Precision | Recall | F1 | Hard negatives flagged |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `revenue-figures` | yellow | 63 | 66.7% | 98.4% | 79.5% | 0.0% (0/21) |
| `internal-metrics` | yellow | 65 | 67.0% | 100.0% | 80.2% | 10.5% (4/38) |
| `deal-sizes` | yellow | 122 | 83.8% | 68.0% | 75.1% | – |
| `customer-names` | yellow | 152 | 71.4% | 100.0% | 83.3% | – |
| `unreleased-roadmap` | red | 157 | 78.7% | 87.3% | 82.8% | 52.0% (26/50) |
| `secrets` | red | 4,284 | 97.9% | 93.3% | 95.5% | 0.0% (0/25) |
| `customer-personal-data` | red | 108,095 | 97.7% | 98.0% | 97.9% | 16.7% (1/6) |

## Caveats

- **Macrohard scores are an upper bound.** Only the offline (template) Macrohard corpus exists so
  far (no `macrohard-llm` source in the splits). Test documents reuse templates with held-out
  snippets and values, so the five business labels are easier here than in real text.
- **Red recall on Macrohard is 91.5%, under target.** Misses are mostly long secrets (PEM blocks,
  connection strings): GLiNER spans are at most 12 words, and GLiNER splits on punctuation.
  Training teaches the first 12 words; tier 0 regexes should catch these whole (regex ∪ model:
  94.1%).
- **Roadmap hard negatives: 52% flagged.** Press releases that name a shipped codename or a
  public date look like roadmap items. SPEC §4 gives this judgement to tier 2.
- **Public "safe" records are noisy.** Many Gretel records without gold spans contain names,
  IBANs or example.com emails; the model flags those, which counts as a false positive. Gretel
  also labels example.com emails as personal data while Macrohard never does, so the training
  data disagrees with itself on them.
- **Admin-defined types are untested.** The model was tuned on the 7 default types. It still
  works with other wordings of those types (above), but how well it finds a brand-new type from
  its name alone is not measured.
- **Off-the-shelf variants were run on the Apple GPU (PyTorch MPS) in batches** for speed, so
  their reports have no latency. Latency is measured below on the ONNX export.

## Latency (ONNX export, onnxruntime CPU, one document per call)

Apple M3 Max (16 cores), idle machine, Python onnxruntime 1.31 with default threads, the
harness's `predict()` wall clock (word split + tokenizer + windows + model + decode), 1,705 test
records (500 per source), after 3 warm-up calls. The #5 spike showed the TypeScript port within a
few ms of this.

| Text size (UTF-8 bytes) | Records | p50 ms | p95 ms | ms per KB (median) |
| --- | ---: | ---: | ---: | ---: |
| 0–500 | 851 | 21 | 39 | 111 |
| 500–1,000 | 338 | 57 | 100 | 77 |
| 1,000–2,000 | 362 | 108 | 261 | 73 |
| 2,000–4,000 | 154 | 254 | 278 | 110 |
| all | 1,705 | **40** | **256** | |

A ~300-token text (about 1.2 KB) takes ~100 ms. Tier 0 + 1 p95 < 300 ms holds on this machine for
texts up to ~4 KB; cost then grows linearly (~75-110 ms per KB), so large tool outputs will need
the agent's time budget or a smaller/quantised model. Latency on a base M-series Mac (fewer
cores) is not measured: the #5 spike found it roughly linear in cores. Same size as the #5 model,
so memory is the same (~1.5-1.9 GB RSS in the spike). Medium and large are slower (larger
encoders); they were not timed since they weren't competitive on accuracy.

## Reproduce

```bash
cd ml
# off-the-shelf, e.g. small with the `fine` labels: predict once at 0.1, pick the threshold on dev
uv run python -m safecontext_ml.tagger.predict urchade/gliner_small-v2.1,device=mps,threshold=0.1,prompts=fine \
    --split dev --per-source 300 --out results/preds/small-fine-dev.jsonl
uv run python -m safecontext_ml.tagger.sweep results/preds/small-fine-dev.jsonl --split dev --per-source 300
uv run python -m safecontext_ml.tagger.predict urchade/gliner_small-v2.1,device=mps,threshold=0.1,prompts=fine \
    --split test --out results/preds/small-fine-test.jsonl
uv run python -m safecontext_ml.tagger.sweep results/preds/small-fine-test.jsonl --write results/preds/gliner-small-v2.1-fine-t0.35.jsonl --at 0.35
uv run python -m safecontext_ml.eval predictions:results/preds/gliner-small-v2.1-fine-t0.35.jsonl

# the chosen model
uv run python -m safecontext_ml.tagger.finetune --out models/tier1-small-ft   # 4,000 steps, 1 h 48 min on an M3 Max
uv run python -m safecontext_ml.export                                         # -> models/tier1-onnx/
uv run python -m safecontext_ml.eval gliner:models/tier1-onnx,device=onnx --per-source 500
```

Fine-tuning settings (`models/tier1-small-ft/finetune_args.json`): base `urchade/gliner_small-v2.1`,
4,000 steps, batch 8, encoder lr 1e-5, other layers 5e-5, focal loss (α 0.75, γ 2), linear
schedule with 5% warm-up, 20,000 public PII records + 1,550 Macrohard records ×4 from `train`,
seed 0. Checkpoints were compared on dev every 500 steps; the last one (4,000) was best
(dev: mean per-source F1 94.4%, red recall 96.3%).
