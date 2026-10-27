# ml/

Python 3.14 + uv. Data generation, evaluation, fine-tuning and ONNX export for the Safe Context
classifier (SPEC.md §4). Run everything from this directory with `uv run ...`.

| Path | What |
| --- | --- |
| `src/safecontext_ml/dataset/` | The dataset: record format, generators, public dataset converters, splits (issue #11) |
| `data/LICENCES.md` | Licences of the public datasets we use, and the ones we rejected |
| `spikes/gliner/` | GLiNER ONNX spike (issue #5) |
| `tests/` | `uv run pytest` |

Never commit data, weights or exports. `data/raw/` is gitignored at the repo root;
`data/sources/` and `data/splits/` in `ml/.gitignore`.

## Dataset

### Quick start

```bash
cd ml
uv run python -m safecontext_ml.dataset offline                 # Macrohard corpus from templates (free)
uv run python -m safecontext_ml.dataset public download nemotron-pii --yes   # once per dataset
uv run python -m safecontext_ml.dataset public convert nemotron-pii
uv run python -m safecontext_ml.dataset build                   # -> data/splits/
```

```python
from safecontext_ml.dataset import load_split, SPAN_LABELS, RED_LABELS
test = load_split("test")   # list[Record]
```

### Commands

All are `uv run python -m safecontext_ml.dataset <command>`.

| Command | Does | Cost |
| --- | --- | --- |
| `offline [--docs-per-genre 200] [--seed 0]` | Writes `data/sources/macrohard-offline.jsonl` from templates. Deterministic. | Free, no network |
| `llm [--n-per-genre 100] [--model claude-sonnet-5-5] [--effort medium] [--dry-run] [--yes] [--max-requests N]` | Writes `data/sources/macrohard-llm.jsonl`. Without `--yes`, sends nothing: it says how many requests it would send and roughly what they'd cost, and builds from cached responses only. `--dry-run` prints sample prompts. | **Paid** (Anthropic API, `ANTHROPIC_API_KEY`) |
| `public list` | Lists the public datasets, licences and sizes | Free |
| `public download NAME --yes` | Downloads a pinned commit into `data/raw/public/NAME/` | Download |
| `public convert NAME [--limit N]` | Writes `data/sources/NAME.jsonl` | Free |
| `build [--refreeze]` | Merges every `data/sources/*.jsonl` into `data/splits/{train,dev,test}.jsonl` + `manifest.json` | Free |
| `stats FILE...` | Validates JSONL files and counts labels | Free |

LLM responses are cached in `data/raw/llm-cache/<model>/<sha256 of request>.json`, so a rerun
never pays twice and the LLM source can be rebuilt from the cache alone.

### File layout

```
ml/data/
  LICENCES.md                 committed
  raw/                        gitignored
    public/<name>/            downloaded datasets (pinned commits)
    llm-cache/<model>/        one JSON file per Claude response
  sources/<source>.jsonl      gitignored; one normalised file per source
  splits/                     gitignored
    train.jsonl dev.jsonl test.jsonl
    manifest.json             counts per split / label / source / genre, sha256 of each split
```

Sources: `macrohard-offline`, `macrohard-llm`, `nemotron-pii`, `gretel-pii-finance`, `gretel-pii-en`.

### Record format (schema version 1)

JSONL, UTF-8, one record per line. Fields in this order:

```json
{
  "id": "mh-offline-sales-notes-00086",
  "text": "Corvid Health signed! $2.0M ACV. Contact: Jolene Kristiansen.",
  "spans": [
    {"start": 0, "end": 13, "label": "customer-names", "text": "Corvid Health"},
    {"start": 22, "end": 27, "label": "deal-sizes", "text": "$2.0M"},
    {"start": 42, "end": 60, "label": "customer-personal-data", "text": "Jolene Kristiansen"}
  ],
  "source": "macrohard-offline",
  "group": "mh-offline-sales-notes-00086",
  "genre": "sales-notes",
  "negative_for": [],
  "ignore": [],
  "meta": {"backend": "offline", "seed": 0, "snippets": ["sales-007", "sales-017"]}
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique across the whole dataset. |
| `text` | The document. |
| `spans` | Sensitive spans, sorted by `start`, never overlapping. `start`/`end` are **Python string indices: Unicode code points, 0-based, `end` exclusive**, and `text[start:end] == span.text`. TypeScript strings count UTF-16 units, so convert offsets before comparing with JS output when the text has characters outside the BMP (emoji). Span text never starts or ends with whitespace. |
| `label` | A data type **id** from `packages/policy/src/defaults.ts`, never a display name. Only the 7 non-green types appear: `revenue-figures`, `internal-metrics`, `deal-sizes`, `customer-names` (yellow); `unreleased-roadmap`, `secrets`, `customer-personal-data` (red). Green types (`public-docs`, `release-notes`, `open-source-code`) are never spans: green text is text with no spans. |
| `source` | Which generator or public dataset the record came from. Report scores per source. |
| `group` | The split key (see Splits). Records that are near-copies of each other share a group. |
| `genre` | `slack-thread`, `incident-log`, `support-ticket`, `launch-review`, `finance-update`, `sales-notes`, `code`, `press-release`, `release-notes`, `public-docs` (Macrohard), or `public-pii` (public datasets). |
| `negative_for` | Labels the record was built to **look like** without containing. Non-empty = a hard negative (press release vs roadmap, public vs private numbers, placeholder vs real key). Any prediction of these labels on this record is a false positive. |
| `ignore` | Regions labelled sensitive in a public source but with no matching data type here (dates, cities, company names, ethnicity...). Each has `start`, `end`, `text` and the **source's** label. A prediction overlapping an ignore region is neither a true nor a false positive: drop it before scoring. |
| `meta` | Free-form provenance: backend, seed, snippet ids, model, the source's document type. Don't score on it. |

`safecontext_ml.dataset.validate(record)` checks all of the above. `build` refuses invalid records
and duplicate ids.

#### Labelling rules

The span is the smallest piece of text that carries the sensitive value.

- **Numbers** (`revenue-figures`, `internal-metrics`, `deal-sizes`): the number with its currency,
  magnitude and unit: `$4.2M`, `18%`, `-3.2%`, `340 ms`, `3,412`, `143.3k`. Not the words around
  it ("revenue", "up").
- **`customer-names`**: the organisation's name, `Bluefin Logistics`.
- **`unreleased-roadmap`**: the codename (`Project Heron` or `Heron`) and the planned date of an
  unreleased launch (`March 3`, `Q2 2027`). A codename that has already shipped publicly, or a
  date that was announced publicly, is **not** labelled.
- **`secrets`**: the value only, never the variable name: the key or token, the password, the
  whole PEM block, or the whole connection string when it contains a password.
- **`customer-personal-data`**: names and contact details of customers and end users: name,
  email, phone, card number, postal address, IP address. Public datasets add IDs (SSN, passport,
  IBAN, account numbers...), date of birth and user names. **Macrohard staff names and chat
  handles are not labelled.**
- **Never labelled** (safe look-alikes): placeholders (`<YOUR_API_KEY>`), env var names
  (`STRIPE_SECRET_KEY`), example.com addresses, masked values (`card ending 4242`), git SHAs and
  UUIDs, public prices and public statistics (`99.95% uptime SLA`), shipped product names.

Public dataset labels are mapped in `public.LABEL_MAP`. Mapped to `customer-personal-data`: email,
phone, address, card numbers and CVV, government IDs, bank account numbers, date of birth, names,
user names, IP and MAC addresses, device and vehicle identifiers. Mapped to `secrets`: api_key,
password, PIN. Everything else becomes an `ignore` region, including dates, cities, countries,
company names, employee IDs, cookies and special-category data (ethnicity, religion, politics,
sexuality). `convert` prints any label it has never seen.

### Splits

- 80 / 10 / 10 train / dev / test, decided by `sha256("safecontext-split-v1:" + group) % 100`
  (`split.py`). Deterministic on every machine. Adding data never moves existing records.
- `group` keeps near-copies together: each Macrohard document is its own group; the two
  Nemotron-PII documents that share a persona `uid` share a group.
- **Entity pools are split too.** Customer names, people and codenames are partitioned with the
  same hash, so no test customer or codename ever appears in train.
- **Offline snippet banks** split by position (`banks.snippet_split`): positions 3, 13, 23... are
  dev, 7, 17, 27... are test. Only append to a bank; inserting or reordering moves snippets.
- We ignore the public datasets' own train/test splits and use ours.
- Texts that are identical after collapsing whitespace and case are kept once, in the most
  protected split (test, then dev, then train).
- **The test split is frozen.** `build` refuses to write a `test.jsonl` that differs from the
  existing one. Pass `--refreeze` only on purpose (new data, generator change) and say so in the
  PR. `manifest.json` holds each split's sha256 so results can name the exact test set.

Sizes from the current build (offline Macrohard, 200 documents per genre, plus all three public
datasets):

| Split | Records | Macrohard | Hard negatives | Nemotron-PII | Gretel finance | Gretel en |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| train | 232,658 | 1,550 | 576 | 160,053 | 23,068 | 47,987 |
| dev | 29,174 | 216 | 95 | 20,006 | 2,886 | 6,066 |
| test | 29,018 | 205 | 79 | 19,940 | 2,926 | 5,947 |

Public data only has `customer-personal-data` and `secrets`. The five business labels (revenue,
metrics, deals, customers, roadmap) come only from the Macrohard sources, so **report scores per
source**, or the public PII swamps them.

### The Macrohard corpus

"Macrohard" is a made-up software company; every name, number and secret is invented and
generated at run time.

- **Offline backend** (`offline.py`, `banks.py`, `values.py`): a document is a header plus a few
  snippets from a genre's banks, with `{{kind}}` slots filled from `values.SLOT_KINDS`. Labelled
  slots become spans; unlabelled slots are safe look-alikes. Secrets use realistic formats (AWS,
  Stripe-style, GitHub, Slack, JWT, PEM, connection strings); cards pass the Luhn check; phone
  numbers use fictional ranges (555-01xx, 07700 900xxx). It is deterministic and has little variety
  (each bank has only two dev and two test snippets), so use it for plumbing and smoke tests;
  its scores are an upper bound.
- **LLM backend** (`llm.py`): plans scenarios deterministically (genre, index, split), pre-samples
  entity values from that split's pools, and asks Claude to write the document with inline tags
  (`<customer-names>Bluefin Logistics</customer-names>`, parsed by `markup.py`). About 20-40% of
  scenarios per business genre, and all public genres, are hard negatives. Responses are rejected
  if the markup is broken, a hard negative contains tags, or a provided sensitive value appears
  untagged. Requests go through `client.beta.messages.create` with refusal fallbacks
  (`fallbacks="default"`).

## Tests and lint

```bash
uv run pytest
uv run ruff check .
```

The tests import from `src/` directly (`pythonpath` in `pyproject.toml`), so `uv sync --only-dev`
is enough to run them, the same as CI's ruff job. They check that `labels.py` still matches
`packages/policy/src/defaults.ts`.
