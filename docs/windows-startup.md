# Windows development: startup and model-free checks (W1)

This is a native Windows developer setup on the Windows work branch. It starts a
rules-only local agent and exercises the plugin's startup/status script. It is
not an installer, a finished Windows security port, or evidence that all Claude
data routes are protected. The [W0 baseline](windows-baseline.md) records the
remaining restoration, state-directory and permission work.

See [Windows file restoration (W2)](windows-restoration.md) for the subsequent
path checks, supported cases and remaining limits.

## Prerequisites

- PowerShell **7** (`pwsh`), Node **24** and **pnpm 12.14.0** (the version pinned in
  the root `package.json`), available on PATH. Use your approved installation
  method; this helper installs nothing and changes no execution policy.
- **Git for Windows**, including `usr/bin/sh.exe`, `usr/bin/sed.exe`, and a working
  `curl.exe`. A normal Git installation supplies these. Git must be on PATH, or
  pass its installation directory with `-GitRoot 'C:\Program Files\Git'`.
- Dependencies installed with `pnpm install --frozen-lockfile`. Keep the existing
  dependency approvals; do not approve additional install scripts to get past an
  error. No dashboard database, model downloads, API keys or training are needed
  for this procedure.
- For the later live plugin check only: an approved Claude Code installation
  supporting HTTP `onFailure: "block"` (**2.1.295+**; CI validates with 2.1.302).
  The offline checks below do not launch Claude or consume model usage.

## Prepare each terminal

From the repository root in PowerShell 7:

```powershell
& .\scripts\windows-dev.ps1
```

This checks the pinned tools and adds Git's `usr/bin` and `mingw64/bin` to **this
terminal's process PATH**. Tests and Claude launched from this terminal inherit
it. It does not change the user/machine PATH or another running app. It leaves
existing `SC_*` settings intact. Run it in each new terminal. A failed prerequisite
check restores the original PATH and stops with an error.

If Git cannot be discovered from the `git.exe` on PATH:

```powershell
& .\scripts\windows-dev.ps1 -GitRoot 'C:\Program Files\Git'
```

Do not launch Claude from a desktop shortcut and assume it inherited this setup.
`CLAUDE_CODE_GIT_BASH_PATH` helps Claude locate its Bash tool, but does not by
itself put `sh` on PATH for the plugin's exec-form hook.

## Run the isolated rules-only agent

In the first prepared terminal:

```powershell
& .\scripts\windows-dev.ps1 -StartAgent
```

The foreground agent uses the built-in default policy on **127.0.0.1:4747**.
For this command only, the helper removes existing `SC_*` settings so configured
models, dashboard connections, credentials and custom policies are not inherited.
It restores those settings when the command returns. The terminal PATH remains
prepared. Ctrl+C stops the agent. If port 4747 is occupied, stop and identify its
owner; do not change the plugin URLs or kill an unrelated process.

This demo detects built-in rules; it does not load the company's policy or prove
model-based detection works. Use synthetic data only. For normal configured agent
development, prepare the terminal without `-StartAgent`, set the approved settings
and use the existing `pnpm --filter @safecontext/agent dev` command.

In a second prepared terminal:

```powershell
Invoke-RestMethod 'http://127.0.0.1:4747/health'
sh ./plugin/scripts/agent-status.sh
sh ./plugin/scripts/agent-status.sh --session-start
```

Expect `ok: true`, policy version 0 and a running status. The session-start command
returns the agent's existing `hookSpecificOutput` JSON when the note is available.
Stopping the agent produces a `systemMessage` explaining how to restart it. The
warning is informational: enforcement remains in the unchanged HTTP hooks.

## Run model-free checks

Use a terminal with real-model opt-ins (`SC_TIER1_MODEL_DIR`, `SC_TIER2_REAL`) unset.
Do **not** run `test:e2e` as part of this procedure; it launches real Claude and
uses model quota.

```powershell
pnpm --filter @safecontext/policy check
pnpm --filter @safecontext/policy test
pnpm --filter @safecontext/detectors check
pnpm --filter @safecontext/detectors test
pnpm --filter @safecontext/agent check
pnpm --filter @safecontext/agent lint
pnpm --filter @safecontext/agent test
```

The default agent suite includes synthetic status checks for healthy/unhealthy
agents, no listener, a non-agent service, an unavailable session note, invalid
ports, and a plugin path containing spaces and `José`. On Windows it also runs
the PowerShell helper from such a path, verifies inherited hook utilities, and
checks that a missing Git installation leaves PATH unchanged. The existing
fail-mode and privacy tests exercise enforcement without contacting a real model.

W1 recorded three W0 failures on the baseline account. W2 now runs the directory
link boundary assertion with a Windows junction, retaining Unix symlink coverage.
The macOS-specific state-directory expectation (W5) and POSIX `0600`
cache-permission expectation (W5) remain. Do not skip them or treat the current
results as a fully passing Windows port. The dated W1 results below are historical.

### W1 verification on 2026-11-12

On the W0 Windows account, using PowerShell 7.6.9, Node 24.22.1 and pnpm 12.14.0:

| Check | Result |
| --- | --- |
| Policy type check and tests | Pass; 54 tests |
| Detector type check and tests | Pass; 519 tests, 1 existing skip |
| Agent type check and lint | Pass |
| Startup/status suite | Pass; 17 tests, including failure cleanup and Windows path cases |
| Full offline agent suite in a fresh checkout at `Safe Context José checkout` | 423 pass, 5 existing skips, the 3 W2/W5 failures listed above |
| Fresh checkout with `core.autocrlf=true` | All 81 attributed files have LF; policy tests still pass; dependencies reused/refreshed at their existing locked versions |
| Actual rules-only startup via the helper | Healthy on 4747 with inherited model/dashboard settings isolated; harmless prompt allowed; fake secret blocked and original prompt suppressed |
| Status, startup note and shutdown warning | Pass; fake secret absent from responses and logs |

No live Claude session or real model was run. Existing macOS/Linux CI still needs
to pass on the PR; it does not replace a future live Windows Claude check.

## Stable checkout bytes

`.gitattributes` pins LF for shell scripts, generated policy schemas, shared
Tier 2 prompt files, and agent source/tests (whose formatter requires LF). This
overrides `core.autocrlf=true` for those files so a fresh Windows checkout has the
same bytes as Unix. It changes no schema or prompt
content and requires no regeneration. Other files keep the team's existing
checkout behavior.

For an older working copy that already contains CRLF in these files, finish or
save local edits before making a fresh checkout of the Windows work branch.
Do not use a destructive reset over work in progress.

## Optional live Claude check: separate authorization and quota

After the offline checks, a developer with permission and Claude access can
prepare a terminal, keep the agent running and launch:

```powershell
claude --plugin-dir ./plugin
```

Check the startup note and `/safe-context:status`, then use only synthetic clean
text and fake secrets to check allowed/blocked prompts. Stop the agent and verify
a new prompt and attempted tool call are blocked, then restart and retry. This
manual step checks actual Claude behavior; the offline tests cannot prove it.
Do not use real company data to test disclosure boundaries.

## Why Git's shell is explicit

The [Claude hook reference](https://code.claude.com/docs/en/hooks) says that hooks
with an `args` array spawn the named command directly through PATH, without a
shell. Plugin-root substitution stays a single argument even with spaces. Our
existing SessionStart hook names `sh`; its status skill uses the same script.
Keeping that interface preserves the macOS behavior and avoids adding a Node
dependency to the standalone health script.

Claude's [Windows setup](https://code.claude.com/docs/en/setup) makes Git Bash
optional for Claude itself; **this plugin currently requires it**. PowerShell
[environment variables](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables)
are inherited by child processes. Git's
[`text` and `eol` attributes](https://git-scm.com/docs/gitattributes) define the
checkout line endings used here. These references were checked on 2026-11-12.
