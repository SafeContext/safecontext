# Windows: download the pinned Tier 1 files

W3 prepares the Tier 1 ONNX files for the agent. It does not run the model, install
Ollama, train a model or establish detection accuracy. W4 covers inference.

## Download tools without the training stack

Use PowerShell from the repository root, with uv installed. The project uses
Python 3.14. `ml/download.py` declares only Hugging Face Hub 1.33.0; its adjacent
`download.py.lock` pins the transitive packages and distribution hashes. uv runs
this script in an isolated cached environment, ignoring `ml/pyproject.toml` and
its Apple training dependencies. This is a Python environment on your computer,
not a VM or remote service. The existing Mac commands and training lock are intact.

The first command may download Python 3.14 and the locked tooling packages; it
does **not** download model files or contact Ollama:

```powershell
uv run --locked .\ml\download.py status
```

`NOT READY` is expected before a download. Exit codes: 0 = all pinned Tier 1
files verified; 2 = missing, partial or mismatched bundle; 1 = access/download
error. Verification checks every required file's size and SHA-256, not merely
the presence of the directory. It reads local files and can take time for a
large model. It does not initialize Hugging Face authentication for status.

With an existing Python 3.14 interpreter, status also works without third-party
packages: `python -S .\ml\download.py status`. Other Python minor versions are
rejected with instructions. Do not use the Mac training environment on Windows.

## Private access and the actual download

Each person needs their own Hugging Face account, an accepted invitation to the
private `SafeContext` organization and read permission for `SafeContext/tier1-gliner`.
GitHub repository access does not grant this. Never share a teammate's token.

Only after access and the real download are approved, authenticate interactively
using the same script environment (enter credentials at the prompt, not in a
command, issue or chat):

```powershell
uv run --locked .\ml\download.py login
```

Then download only the Tier 1 inference bundle:

```powershell
uv run --locked .\ml\download.py pull
uv run --locked .\ml\download.py status
```

The lock currently specifies seven files totaling **619,630,111 bytes** (about
620 MB decimal / 591 MiB). The downloader uses the manifest's exact commit,
expected sizes and SHA-256 hashes; it never selects `latest`. It skips verified
files and replaces missing/corrupt files only after a staged download verifies.
An interruption can leave a partial bundle, which status reports as NOT READY.
Retry the same command to verify and reuse completed files.

Allow additional space for one staged file (the largest is about 611 MB), existing
files being replaced, tooling environments and Hugging Face/Xet caches. Cache
space depends on the transfer backend; 620 MB free is insufficient as a general
space estimate. Downloads are staged on the same volume as their final directory.
Do not run parallel pulls into the same model directory.

Do not substitute `pnpm models:pull` for this first-use command: that existing
command can also select training weights and datasets. The Windows script accepts
`status`, `pull` and interactive `login`; artifact operations select only
`tier1-onnx`. Login does not add a token to Git credentials. Tier 2 Ollama/MLX entries are
external references and are not fetched here. Weights remain gitignored.

## Locations and failure recovery

Files land in `ml/models/tier1-onnx`, independent of the caller's current directory.
Use an ordinary local directory. The downloader refuses links/junctions, other
Windows reparse points and hard-linked model files along the paths it inspects.
Do not use UNC/device paths, mapped/network storage, cloud placeholders or a
linked checkout for this supported setup. A drive letter alone does not establish
local storage. Case-sensitive Windows directories and hostile concurrent path
changes are unverified; these checks are not a filesystem sandbox.

Each transfer uses its own `.hf-download-*` staging directory. It never recursively
cleans an old staging directory left by another invocation. Normal errors clean
owned staging; forced process termination or a locked file can leave it behind.
If a cleanup warning appears, inspect the named pattern under the intended model
directory before removing anything. Never delete a model directory blindly.

- Missing access: confirm your own organization invitation and read permission.
- Missing pinned revision/file: check that this branch's manifest matches the
  published artifacts; ask the model owner. Do not rewrite hashes or revisions.
- Hash/size mismatch: the bad staged file is discarded; keep the failure evidence
  and ask the model owner before retrying a persistent mismatch.
- Disk, locked-file or permission error: free space, close the process holding the
  file and check user permissions, then retry. No administrator settings are needed.
- Network error: retry once connectivity is restored. Raw exception details are
  withheld because they can contain credentials or signed URLs.

For W4, after status reports VERIFIED, prepare an absolute agent setting:

```powershell
$env:SC_TIER1_MODEL_DIR = (Resolve-Path .\ml\models\tier1-onnx).Path
```

This setting alone does not verify ONNX loading or Windows predictions. The W1
rules-only startup command clears model settings by design; W4 must document the
model-enabled startup separately.

## Verification evidence

Automated tests use synthetic files and a fake Hugging Face client: no private
artifacts, credentials, paid inference or real model downloads are required.
They cover exact revision selection, checksums and sizes, reuse/repair, partial
bundles and retry, redacted access/network errors, spaces/Unicode, owned staging,
directory-link escapes, hard links and locked-file failures.

Verified on native Windows x64 with Python 3.14.7, uv 0.12.19, Hugging Face Hub
1.33.0, pytest 9.1.1 and Ruff 0.17.1. The development venv installed only the
download dependencies plus pytest/Ruff; no training packages were installed.

- Artifact and Windows downloader suites: **100 passed**, including actual
  Windows junctions, a hard link and an exclusive file-sharing lock. Junction
  fixtures need a process allowed to create junctions; the restricted execution
  sandbox denied them, and the ordinary user-context run passed without admin
  or Developer Mode changes.
- `ruff check .` from `ml/`: passes. `git diff --check`: passes.
- `uv run --offline --locked ml/download.py status`: NOT READY for the missing
  seven-file model bundle; no private transfer or authentication was performed.
- `python -S ml/download.py status` with Python 3.14: the same local result,
  demonstrating that status/imports do not need the training stack. Python 3.11
  is rejected with the Python 3.14 instruction.

A passing fake-client test is separate from a real private download; a real
download is separate from W4 inference. No real download or inference was run.

Primary references checked for this implementation:
[uv script isolation and locking](https://docs.astral.sh/uv/guides/scripts/),
[Hugging Face Hub 1.33 download API](https://huggingface.co/docs/huggingface_hub/v1.33.0/guides/download),
and [Python 3.14 filesystem paths](https://docs.python.org/3.14/library/pathlib.html).
