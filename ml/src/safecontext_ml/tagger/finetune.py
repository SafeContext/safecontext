"""Fine-tune GLiNER on our data types (train split only; dev for checkpoint choice).

    uv run python -m safecontext_ml.tagger.finetune --base urchade/gliner_small-v2.1 \
        --out models/tier1-small-ft --steps 4000

Writes Hugging Face style checkpoints to `--out/checkpoint-N/` and the final model to `--out/`
(under `ml/models/`, gitignored). Uses the Apple GPU (PyTorch MPS) when available. Long runs:
start it in the background with a log file; `--resume` continues from the last checkpoint.

How records become GLiNER training examples:
- The prompt is the `names` prompt set: every data type's display name in lower case
  ("customer personal data"). All seven are given on every example, so the model learns to
  tell them apart, and hard negatives (no spans) teach it what not to flag.
- Public PII records never contain business labels. When they have `company` ignore regions,
  "customer names" is left out of their prompt, so company names there are not taught as
  negatives (our Macrohard data labels customer companies).
- Documents are cut into windows that fit the encoder (`chunking`), never inside a span.
- A span longer than the model's `max_width` (12 words, e.g. a PEM block) is truncated to its
  first `max_width` words: the model learns to flag the start of it. Tier 0 regexes catch these
  whole.
- Macrohard is ~0.7% of the train split, so it is oversampled (`--macrohard-repeat`) and
  public PII is subsampled (`--public`).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

from ..dataset.build import load_split
from ..dataset.paths import ML_ROOT
from ..dataset.schema import Record
from . import chunking
from .prompts import NAMES

COMPANY_IGNORE = {"company", "company_name"}


def to_examples(
    rec: Record, tokenizer: Any, budget: int, max_width: int, max_words: int = 384
) -> list[dict[str, Any]]:
    """One record -> GLiNER training examples (`tokenized_text`, `ner`, `ner_labels`)."""
    offsets = chunking.words(rec.text)
    if not offsets:
        return []
    pieces = [rec.text[s:e] for s, e in offsets]
    counts = [
        max(1, len(x)) for x in tokenizer(pieces, add_special_tokens=False)["input_ids"]
    ]
    # word index ranges of each span
    spans: list[tuple[int, int, str]] = []
    for sp in rec.spans:
        idx = [i for i, (s, e) in enumerate(offsets) if s < sp.end and e > sp.start]
        if idx:
            first, last = idx[0], idx[-1]
            spans.append((first, min(last, first + max_width - 1), NAMES[sp.label]))
    inside = [False] * len(offsets)  # word i is inside a span (not its first word)
    for first, last, _ in spans:
        for i in range(first + 1, last + 1):
            inside[i] = True

    labels = list(NAMES.values())
    if rec.genre == "public-pii" and any(
        ig.label.lower() in COMPANY_IGNORE for ig in rec.ignore
    ):
        labels.remove(NAMES["customer-names"])

    out = []
    i = 0
    n = len(offsets)
    while i < n:
        j, used = i, 0
        while j < n and j - i < max_words and (used + counts[j] <= budget or j == i):
            used += counts[j]
            j += 1
        # never cut inside a span: move the cut back to the span's first word
        while j < n and inside[j] and j > i + 1:
            j -= 1
        ner = [[a - i, b - i, lab] for a, b, lab in spans if a >= i and b < j]
        shuffled = labels[:]
        random.shuffle(shuffled)
        out.append({"tokenized_text": pieces[i:j], "ner": ner, "ner_labels": shuffled})
        i = j
    return out


def build(
    split: str,
    tokenizer: Any,
    budget: int,
    max_width: int,
    public: int,
    macrohard_repeat: int,
    seed: int,
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    records = load_split(split)
    mh = [r for r in records if r.source.startswith("macrohard")]
    pub = [r for r in records if not r.source.startswith("macrohard")]
    pub = rng.sample(pub, min(public, len(pub)))
    examples: list[dict[str, Any]] = []
    for r in pub:
        examples += to_examples(r, tokenizer, budget, max_width)
    for _ in range(macrohard_repeat):
        for r in mh:
            examples += to_examples(r, tokenizer, budget, max_width)
    rng.shuffle(examples)
    print(
        f"{split}: {len(mh):,} Macrohard x{macrohard_repeat} + {len(pub):,} public records "
        f"-> {len(examples):,} examples",
        file=sys.stderr,
    )
    return examples


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m safecontext_ml.tagger.finetune")
    p.add_argument("--base", default="urchade/gliner_small-v2.1")
    p.add_argument("--out", type=Path, default=ML_ROOT / "models" / "tier1-small-ft")
    p.add_argument("--steps", type=int, default=4000)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--lr", type=float, default=1e-5, help="encoder learning rate")
    p.add_argument("--others-lr", type=float, default=5e-5, help="span/prompt layers")
    p.add_argument(
        "--public", type=int, default=20000, help="public PII records to sample"
    )
    p.add_argument("--macrohard-repeat", type=int, default=4)
    p.add_argument("--dev-public", type=int, default=600)
    p.add_argument("--save-steps", type=int, default=500)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--resume", action="store_true")
    p.add_argument(
        "--device", default=None, help="cpu or mps (default: mps if available)"
    )
    args = p.parse_args(argv)

    import torch
    from gliner import GLiNER
    from gliner.training import Trainer

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = args.device or ("mps" if torch.backends.mps.is_available() else "cpu")
    model = GLiNER.from_pretrained(args.base)
    tok = model.data_processor.transformer_tokenizer
    cfg = model.config
    prompt_tokens = sum(
        len(tok(x, add_special_tokens=False)["input_ids"])
        for lab in NAMES.values()
        for x in (cfg.ent_token, lab)
    ) + len(tok(cfg.sep_token, add_special_tokens=False)["input_ids"])
    budget = 512 - 2 - prompt_tokens - 8
    max_width = int(cfg.max_width)

    train = build(
        "train", tok, budget, max_width, args.public, args.macrohard_repeat, args.seed
    )
    dev = build("dev", tok, budget, max_width, args.dev_public, 1, args.seed)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "finetune_args.json").write_text(
        json.dumps({k: str(v) for k, v in vars(args).items()}, indent=1)
    )
    model.to(device)
    training_args = model.create_training_args(
        output_dir=str(args.out),
        learning_rate=args.lr,
        others_lr=args.others_lr,
        weight_decay=0.01,
        others_weight_decay=0.01,
        focal_loss_alpha=0.75,
        focal_loss_gamma=2.0,
        lr_scheduler_type="linear",
        warmup_ratio=0.05,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        max_steps=args.steps,
        save_steps=args.save_steps,
        save_total_limit=20,
        logging_steps=50,
        eval_strategy="steps",
        eval_steps=args.save_steps,
        dataloader_num_workers=0,
        use_cpu=device == "cpu",
        seed=args.seed,
    )
    # model.train_model() without its implicit train(), so --resume works.
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train,
        eval_dataset=dev,
        data_collator=model._create_data_collator(),
        processing_class=tok,
    )
    trainer.train(resume_from_checkpoint=True if args.resume else None)
    trainer.save_model(str(args.out))
    print(f"saved {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
