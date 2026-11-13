# Windows inference checks (W4)

These diagnostics use the existing classifier and API contracts. They do not
change production startup, policy, timeouts or `/health`. A successful smoke run
means the model loads and processes this small corpus; it does not establish
prediction accuracy, complete hook interception or a working all-tier setup.

## Prepare a terminal

From the repository root in PowerShell 7, use the existing Node 24 / pinned pnpm
setup and run:

```powershell
& .\scripts\windows-dev.ps1
```

Do **not** add `-StartAgent`: that starts W1's deliberately rules-only demo and
clears model settings. Model files come from the separate
[W3 download procedure](windows-model-downloads.md). Do not install the Mac
training environment, substitute another model or run `pnpm models:pull` here.

## Offline checks and prerequisites

```powershell
pnpm --filter @safecontext/agent check
pnpm --filter @safecontext/agent exec vitest run src/diagnostics --maxWorkers=2
Push-Location .\apps\agent
try {
    node --import tsx .\scripts\windows-inference.ts preflight
} finally { Pop-Location }
```

The tests fake model computation and network responses. Preflight hashes local
Tier 1 files through W3 and imports the native ONNX binding, without loading a
model, contacting Ollama, logging in or downloading anything. It reports free
RAM, runtime versions and pin verification separately from inference.

By default the file check uses `uv run --offline --locked ml/download.py status`.
Prepare that script environment beforehand with W3; this command cannot install
missing packages. Alternatively append `--python 'C:\absolute\path\python.exe'`
to use an existing Python 3.14 interpreter. Status then runs with `-S` and only
the standard library. A missing interpreter or failed checksum stops model work.

Direct Node exit codes: `0` = requested diagnostic completed; `1` = prerequisite,
reference, runtime or functional failure; `2` = preflight not ready, or the
reference-based Tier 1 run's warm p95 was at least 300 ms. `pnpm exec` may wrap a
nonzero exit as `1`, so inspect the JSON result and use direct Node for receipts.
Errors contain fixed reason codes, not raw exceptions, paths or input values.

## Tier 1 load and timing smoke run

After the actual download and CPU run have been approved:

```powershell
Push-Location .\apps\agent
try {
    node --import tsx .\scripts\windows-inference.ts smoke-tier1 --run-models
} finally { Pop-Location }
```

Append `--python` if using an existing interpreter instead of uv, as above. Every
model mode requires `--run-models`; preflight is the default. These commands do
not download weights. Inherited `SC_*` model settings cannot redirect the run.

Smoke mode requires W3 verification of **all seven files**, at least 3 GiB free
RAM immediately before loading, and uses the ordinary pinned directory
`ml/models/tier1-onnx` by absolute path. It uses `loadGliner` with two intra-op
threads and ONNX Runtime's default CPU configuration. It has a hard 180-second
process limit, including verification and native loading/calls. A native call
may not honor JavaScript cancellation; the overall cap terminates the process.

The fixed corpus is a short fictional public installation guide and an internal
Project Heron roadmap. There are 23 sequential checks: one first call, two
warm-ups, then 20 measured calls, alternating texts. Each successful check must
report that Tier 1 ran; a Tier 0 block or silent rules-only result is insufficient.
Output reports load time, first-call time, nearest-rank warm p50/p95, sample
count and process RSS after the calls. RSS is a snapshot, not peak usage or
model-only memory. No spans, source text, replacements or request bodies are printed.

`predictionCorrectness: unverified_no_matching_reference` is intentional. These
texts are much shorter than the SPEC's roughly 300-token latency corpus. Their
timings cannot establish that target or performance on long files.

## Verify predictions against an independent reference

The tracked stock-model `gliner.test.ts` uses an older spike's expected results.
Do not point it at the current fine-tuned artifact. Obtain a model-owner-approved
synthetic reference for revision
`9f176c61140facd874f36ada78b0ea370e896dc2` before claiming Windows parity.
Do not generate expected results from this Windows run and then call them a
passing independent reference.

The reference JSON has `schemaVersion: 1`, that exact `revision`, a nonempty
`origin` describing the independently approved source, and 2–4 `cases`. Each
case has fictional `text` (at most 4096 UTF-16 code units) and `tier1` expectations:

- `spans`: an array of `{start, end, dataTypeId}`, using JavaScript UTF-16 offsets
  and the built-in default policy's data type IDs; maximum 32 per case.
- `prompt`: `allow` or `block`.
- `tool`: `unchanged` or `rewritten`.

Include at least one positive span, an allowed prompt and a blocked prompt.
Combined runs additionally require a `combined` expectation with the same shape
for every case. Keep the whole JSON below 64 KiB. The parser validates shape and
revision; a filled `origin` alone does not prove independent human approval.

```powershell
Push-Location .\apps\agent
try {
    node --import tsx .\scripts\windows-inference.ts tier1 --run-models --reference 'C:\approved\tier1-reference.json'
} finally { Pop-Location }
```

This checks exact Tier 1 spans, then the real classifier and in-process prompt
and Bash-output endpoints against the declared expectations. It checks the warm
iterations' spans too. It verifies metadata-only agent logs/events and closes the
model after success or failure. There are two warm-ups and 20 timed classifier
checks after the functional checks. The report distinguishes functional results
from the 300 ms comparison; corpus compatibility with the SPEC remains a human
assessment. Direct app requests do not prove real Claude hooks or file interception.

## Combined mode: separate prerequisites

Do not install/download Tier 2 as a side effect of Tier 1. First obtain explicit
approval for the Ollama runtime, its pinned roughly 6.6 GB payload plus storage
overhead, and a bounded CPU/GPU run with adequate memory. The diagnostic requires
at least 10 GiB free RAM for combined mode; that guard is a conservative test
prerequisite, not an established model memory requirement.

The current pin is `gemma4:e4b-it-q4_K_M` with digest
`sha256:dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c`.
The diagnostic contacts only `http://127.0.0.1:11434/v1`, accepting the exact digest
in either bare hex or `sha256:` form from `/api/tags`. It requires a unique exact
model name and checks the digest before loading and after the combined run.
Missing, ambiguous or changed pins fail verification. It does not change the
production client's existing mismatch warning policy.

Once those prerequisites and a matching combined reference are approved:

```powershell
Push-Location .\apps\agent
try {
    node --import tsx .\scripts\windows-inference.ts combined --run-models --reference 'C:\approved\combined-reference.json'
} finally { Pop-Location }
```

Combined mode requires a successful Tier 2 readiness event, actual Tier 2
participation, matching classifier/endpoint expectations and no failed Tier 2
calls. Conservative fallback behavior is tested separately and cannot masquerade
as a successful model run. Existing 8-second agent and 6-second Tier 2 per-call
budgets stay intact; the overall process cap is five minutes including warm-up.

## Model-enabled agent startup

For a later interactive synthetic test, after the corresponding reference run
passes, replace `tier1` with `start-tier1`, or `combined` with `start-combined`, in
the commands above. Keep `--run-models`, `--reference` and any `--python` argument.
Startup validates the reference shape, files, memory and (for combined) installed
digest; it does not rerun the reference comparisons. Run those separately first.

The launcher starts a child agent on the plugin's fixed port 4747 using an
absolute model directory, two threads and the built-in synthetic policy. It
strips inherited `SC_*` settings from that child, including dashboard credentials,
company policy, timeouts and model overrides; the parent terminal stays unchanged.
Sync is off, so no dashboard state or credentials are used. Ctrl+C terminates
the child it started. It does not stop another agent already using the port.

`/health` still means that the HTTP/policy endpoint is alive. It can return 200
while an enabled model is loading or failed. Use model readiness logs plus the
successful reference check as separate evidence. Starting a demo server is not
evidence that it is safe to send company data.

## Evidence and limits

Native Windows 11 x64, Ryzen 5 7530U (6 cores / 12 logical CPUs), 16 GiB installed
RAM (15.38 GiB usable), Node 24.22.1 and ONNX Runtime 1.30.0 were used for the
approved Tier 1 CPU run on 2026-11-12. Free RAM before the run was 4.89 GiB.
The checkout path contained spaces; a real-model Unicode-path run remains
unverified. No GPU provider was requested or measured.

| Stage | Observed result |
| --- | --- |
| Private Tier 1 download | Seven files, 619,630,111 bytes; every pinned size and SHA-256 verified |
| Native binding and model load | CPU load completed in 4316 ms |
| First short-input check | 149 ms |
| Warm short-input checks | 20 measured after two additional warm-ups; p50 101 ms, p95 124 ms; all checks completed within the existing budget |
| Process RSS after calls | 900,419,584 bytes (about 859 MiB); not peak or model-only memory |
| Tier 1 prediction parity | **Unverified**: independently approved current-model reference unavailable |
| Real Tier 2 / combined | **Not run**: separate installation, download, resource and run approval required |
| Real Claude hook integration | **Not run** |

The smoke run processed 23 total fictional inputs with two intra-op threads and
the 180-second cap. It used the shared verified W3 download through the isolated
Python 3.14.7 / Hub 1.33.0 environment. There was no Tier 2 download, training or
cloud inference. The result is a CPU loading/timing receipt, not a quality score.

Offline validation on the same machine:

- New diagnostic tests: **23 passed**; no real models or network calls.
- Full agent suite with model settings cleared and two workers: **526 passed,
  5 existing skips, 2 known W5 failures** (`sync/config.test.ts` assumes a Mac
  state path; `sync/policy-sync.test.ts` assumes POSIX file mode 0600).
- Agent (including scripts), policy and detector type checks pass; agent lint
  and the diagnostic script's explicit format/ESLint checks pass.
- W3 artifact/download regression suite: **112 passed**, including actual
  Windows junction, hard-link and exclusive-lock cases with fake artifacts.
- The broader local `pnpm check` stops at the dashboard's missing generated
  Prisma client and resulting type errors. The existing CI generates that
  client separately; no dashboard setup or credentials were added here.

W4 is incomplete until the matching fine-tuned reference and real Tier 2/combined
checks are available. Keep those items open on #103 and roadmap #88. W5 owns the
two known Windows state/permission failures and dashboard credential handling;
W6 owns Windows CI; W7 owns independent reproduction. No real Claude session,
company data, training or paid API call is part of these diagnostics.

Primary API references:
[ONNX Runtime Node](https://onnxruntime.ai/docs/get-started/with-javascript/node.html),
[session options](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html),
[Ollama tags/digests](https://docs.ollama.com/api/tags), and
[Ollama Windows requirements](https://docs.ollama.com/windows).
