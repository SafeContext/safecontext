# Windows rules-only baseline (W0)

Recorded on 2026-11-12 for [issue #89](https://github.com/SafeContext/safecontext/issues/89),
under the [Windows roadmap #88](https://github.com/SafeContext/safecontext/issues/88).
Application revision tested: `6bc749a04d3acc85ea0beedef5616a42a3da140e`.

**Result:** the existing rules-only agent starts on Windows, answers `/health`,
passes a harmless prompt and blocks a synthetic secret. Windows support is still
incomplete. This baseline does not establish live Claude Code integration,
complete interception coverage, dashboard operation or real-model compatibility.

## Environment

| Item                              | Recorded value                          |
| --------------------------------- | --------------------------------------- |
| Windows version reported by .NET  | Microsoft Windows NT 10.0.26300.0       |
| Architecture                      | X64                                     |
| PowerShell                        | 7.6.9                                   |
| Git                               | 2.45.2.windows.1                        |
| Node used for this baseline       | 24.22.1                                 |
| pnpm used for this baseline       | 12.14.0 (the version in `package.json`) |
| TypeScript / Vitest from lockfile | 6.0.3 / 4.1.12                          |
| Initial Git checkout setting      | `core.autocrlf=true`                    |

The ordinary terminal initially selected Node 20.15.0 and pnpm 11.25.0. The run
instead used an available Node 24 runtime and a workspace-adjacent installation
of pnpm 12.14.0, with PATH changed only for the commands being run. System-wide
tool versions, application dependencies and dependency approvals were unchanged.

## Results

| Check                                                        | Observed result                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                             | Exit 0; 414 workspace packages installed, lockfile unchanged. Dashboard prepare reported an error; see below. |
| Policy and detector `check`                                  | Both passed.                                                                                                  |
| Agent `check`                                                | Passed, including its scripts TypeScript project.                                                             |
| Policy `test`, initial Windows checkout                      | 53 passed, 1 failed: generated schema byte comparison differed only in CRLF versus LF.                        |
| Detector `test`                                              | 519 passed, 1 skipped; all 7 test files passed.                                                               |
| Agent `test`, initial Windows checkout                       | 406 passed, 16 failed, 5 skipped. Failures classified below.                                                  |
| Policy `test`, local LF diagnostic                           | All 54 passed.                                                                                                |
| Agent `test`, local LF diagnostic                            | 410 passed, 12 failed, 5 skipped. The four prompt-rendering failures disappeared.                             |
| Status script test, with Git's `usr/bin` temporarily on PATH | All 13 passed, including agent-down cases. No script edits were needed.                                       |
| Actual service `/health`                                     | HTTP 200, `{"ok":true,"policyVersion":0}`. Listener was `127.0.0.1:4747`.                                     |
| Actual service, harmless prompt                              | HTTP 200, `{}` (passes through).                                                                              |
| Actual service, synthetic token prompt                       | HTTP 200, `decision: "block"`, `suppressOriginalPrompt: true`; token absent from reply.                       |

The first sandboxed Vitest attempts failed before executing tests because the
runner could not rename its temporary files (`EPERM`). The results above come
from rerunning outside that sandbox with the same code and tools. Those initial
runner errors are an execution-environment restriction, not detector failures.

### Remaining failures and their meaning

| Observation                                                                                                                                                                                                                               | Classification                                                                                                                                  | Follow-up                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| One policy schema test and four agent prompt-rendering cases fail with CRLF checkout files. Git stores the originals as LF. Normalizing only `packages/policy/schema/` and `ml/prompts/tier2/` locally to LF removes these five failures. | Checkout setup and byte-exact test portability. Prompt file bytes also affect rendering; no model was invoked.                                  | W1: agree a reproducible checkout/line-ending policy. Do not regenerate contract schemas to disguise checkout-only differences.  |
| Nine status-script tests fail with `spawn sh ENOENT` on the ordinary PATH. Adding the existing Git `usr/bin` directory makes the entire status suite pass.                                                                                | Startup prerequisite and test setup. The plugin still requires `sh` and the script's other utilities.                                           | W1: decide and document the supported Windows startup path and check it in actual Claude Code.                                   |
| Sync default-path test expects `/Users/x/Library/Application Support/SafeContext`, but Windows `path.join` produces backslashes.                                                                                                          | POSIX-specific assertion; application state-directory default is also macOS-specific.                                                           | W5: choose an appropriate Windows state location and test platform defaults.                                                     |
| Policy-cache test expects POSIX mode `0600`; Windows reports `0666`.                                                                                                                                                                      | Test portability and an unresolved application security requirement. A mode-bit assertion does not establish Windows access-control protection. | W5: verify appropriate Windows ACLs for cached policy/term lists. Do not remove the privacy requirement merely to pass the test. |
| One restoration test cannot create its directory symlink (`EPERM`) on this account.                                                                                                                                                       | Test setup lacks symlink capability; the relevant Windows boundary remains unverified.                                                          | W2: cover Windows symlinks/junctions, traversal, drives and protected paths with an agreed test setup.                           |
| Dashboard prepare prints `File '$app/tsconfig' not found.`; its fallback echo command masks the failure and lets installation finish.                                                                                                     | Workspace setup failure outside the rules-only path; its Windows specificity has not been established.                                          | Diagnose separately before claiming dashboard setup works. Successful install alone is insufficient evidence.                    |

The agent's five skipped cases include opt-in real-model tests. Detector results
also contain one skipped test; skipped cases are not counted as passes.

## Reproduce the rules-only path in PowerShell

Use a clean checkout of the tested revision, with Node 24 available in this
terminal. Run from the repository root. The isolated pnpm installation below
keeps the project-pinned tool separate from any existing pnpm installation.

```powershell
node --version # Must be v24.x; the recorded run used v24.22.1.
$toolRoot = Join-Path (Split-Path (Get-Location).Path -Parent) 'output/windows-baseline-tools'
npm install --prefix "$toolRoot/pnpm" --package-lock=false --no-audit --no-fund pnpm@12.14.0
$env:Path = "$toolRoot/pnpm/node_modules/.bin;" + $env:Path
pnpm --version # 12.14.0
pnpm install --frozen-lockfile --store-dir "$toolRoot/store" --reporter append-only

pnpm --filter @safecontext/policy --filter @safecontext/detectors check
pnpm --filter @safecontext/policy test
pnpm --filter @safecontext/detectors test
pnpm --filter @safecontext/agent check
pnpm --filter @safecontext/agent test
```

Run the packages' tests separately so a policy failure does not prevent the
detector tests from running. Expect the failures above on the original checkout.
Keep the existing `pnpm-workspace.yaml` approvals; no new build-script approvals
were needed. Installing ONNX Runtime as a dependency does not download or test
the private model weights.

In a dedicated PowerShell terminal, disable optional integrations for this
process and start the same entry point used by the agent's development command,
without its file watcher. This terminal also needs Node 24 and the isolated pnpm
on PATH; process-local PATH changes do not carry over to another open terminal:

```powershell
$toolRoot = Join-Path (Split-Path (Get-Location).Path -Parent) 'output/windows-baseline-tools'
$env:Path = "$toolRoot/pnpm/node_modules/.bin;" + $env:Path
node --version # Must still be v24.x in this terminal.
pnpm --version # 12.14.0
'SC_DASHBOARD_URL', 'SC_TIER1_MODEL_DIR', 'SC_TIER2_BASE_URL', 'SC_TIER2_MODEL', 'SC_POLICY_FILE' |
    ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
$env:SC_AGENT_PORT = '4747'
pnpm --filter @safecontext/agent exec tsx src/index.ts
```

The log should show `policy_loaded` with version 0, `tier1_off`, `tier2_off`
and `listening` on port 4747. If that port is already in use, identify the owner
before starting another service. No dashboard database or credentials are needed.

In a second terminal at the repository root:

```powershell
$base = 'http://127.0.0.1:4747'
Invoke-RestMethod "$base/health" -TimeoutSec 5
$body = @{
    session_id = 'WINDOWS_BASELINE'
    cwd = (Get-Location).Path
    hook_event_name = 'UserPromptSubmit'
    prompt = 'Explain a for loop using fictional examples.'
}
Invoke-RestMethod "$base/v1/prompt" -Method Post -ContentType 'application/json' `
    -Body ($body | ConvertTo-Json) -TimeoutSec 5

# Construct a fake token at runtime, following the existing test helper.
$fake = 'ghp_' + ('aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC' * 2).Substring(0, 36)
$body.prompt = "Deploy with token $fake please"
$blocked = Invoke-RestMethod "$base/v1/prompt" -Method Post -ContentType 'application/json' `
    -Body ($body | ConvertTo-Json) -TimeoutSec 5
if ($blocked.decision -ne 'block' -or -not $blocked.hookSpecificOutput.suppressOriginalPrompt) {
    throw 'Expected the synthetic token prompt to be blocked and suppressed'
}
if (($blocked | ConvertTo-Json -Depth 10).Contains($fake)) {
    throw 'Synthetic token appeared in the response'
}
```

Stop the agent with Ctrl+C in its own terminal when finished. The baseline test
process was stopped after verification; it was not installed as a background service.

### Diagnostic variations used in this run

On the clean task checkout, only CRLF sequences in `packages/policy/schema/`
and `ml/prompts/tier2/` were replaced with LF, using Node's `readFileSync` and
`writeFileSync`. No JSON, template or schema content was changed. Repeating
policy and agent tests gave the LF results above. Those diagnostic edits were
then restored; this report introduces no shared line-ending policy.

The separate status-suite diagnostic used the existing Git for Windows shell:

```powershell
# In the tool-configured terminal; the exact Git installation path may differ.
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
pnpm --filter @safecontext/agent exec vitest run e2e/plugin-status.test.ts
```

This is evidence about the status script's prerequisites, not a live Claude Code
integration test. No paid `test:e2e`, model downloads, training, enrollment,
dashboard database setup or Windows permission changes were performed.

## Next work

Use separate, reviewed tasks under #88 for W1 startup/checks, W2 path/restoration
boundaries and W5 secure state/credential storage. The current token store invokes
macOS `/usr/bin/security`; passing its mocked tests does not establish Windows
credential support. Model acquisition/inference (W3/W4) and Windows CI (W6) remain
separate. The existing supported-platform statement in the README is unchanged.
