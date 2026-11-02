# Dataset licences

Every public dataset we use, the version we pinned, its licence and what that licence requires.
Only datasets whose licence allows commercial use are used. The data itself is never committed:
`python -m safecontext_ml.dataset public download <name> --yes` fetches it into `ml/data/raw/public/`.

## Used

| Name (`public` source) | Dataset | Pinned commit | Licence | Commercial use | What we use |
| --- | --- | --- | --- | --- | --- |
| `nemotron-pii` | [nvidia/Nemotron-PII](https://huggingface.co/datasets/nvidia/Nemotron-PII) | `b70ffaf5ff39e079776134c5bf4381f00a9fd1ed` | CC BY 4.0 | Yes, with attribution | All 200,000 rows (~307 MB parquet), English, character offsets |
| `gretel-pii-finance` | [gretelai/synthetic_pii_finance_multilingual](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual) | `7b844d16738527a04264f50214cb426a4cea0897` | Apache-2.0 | Yes | 28,910 English rows (`data/English_*.parquet`, ~27 MB); other languages skipped |
| `gretel-pii-en` | [gretelai/gretel-pii-masking-en-v1](https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1) | `e06eb1499ca8d54470f085021cd8e54f9efac7fd` | Apache-2.0 | Yes | All 60,000 rows (~24 MB parquet). No offsets in the source; spans found by whole-word string match |

All three are fully synthetic (no real people), so they carry no personal-data risk of their own.

### Attribution (CC BY 4.0: required wherever we redistribute the data or a model trained on it)

> This product uses **Nemotron-PII** by NVIDIA Corporation (Amy Steier, Andre Manoel, Alexa
> Haushalter, Maarten Van Segbroeck), https://huggingface.co/datasets/nvidia/Nemotron-PII,
> licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). We converted it to our
> label format: labels were mapped to Safe Context data types and some were dropped.

CC BY 4.0 asks us to credit the creator, link the licence and say that we changed the data. Put
the paragraph above in the docs or NOTICE file of anything we ship that includes this data or a
model trained on it. Citation from the dataset card:

```bibtex
@dataset{nemotron-pii,
  author = {Amy Steier and Andre Manoel and Alexa Haushalter and Maarten Van Segbroeck},
  title = {Nemotron-PII: Synthesized Data for Privacy-Preserving AI},
  year = {2025},
  publisher = {NVIDIA},
  url = {https://huggingface.co/datasets/nvidia/Nemotron-PII}
}
```

Apache-2.0 (the Gretel datasets) requires keeping the licence and notices if we redistribute the
data itself. Training on it carries no extra obligation.

## Looked at and not used

| Dataset | Why not |
| --- | --- |
| [ai4privacy/open-pii-masking-500k-ai4privacy](https://huggingface.co/datasets/ai4privacy/open-pii-masking-500k-ai4privacy) (and the newer openpii-1m / 1.5m) | Tagged CC BY 4.0, but the card says it was made with Llama 3.1/3.3, so the Llama Community Licence applies ("Built with Llama", model naming rules), and commercial use "may require written permission" from Ai4Privacy. Too unclear for commercial use. |
| [Samsung/CredData](https://github.com/Samsung/CredData) (secrets in code) | Metadata is Apache-2.0, but every collected source file keeps its own project's licence, and files are fetched from ~300 repos by a script. Would be useful for `secrets`; needs a licence review first. Not implemented. |
| CoNLL-2003, OntoNotes 5 | Research or LDC licences; no commercial use. Also not PII-focused. |
| bigcode/bigcode-pii-dataset | Gated, with research-only terms. |
