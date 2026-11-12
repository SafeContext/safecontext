# Windows file restoration (W2)

SafeContext lets Claude use a placeholder while an approved local file operation
uses the original value. For example, Claude writes `Call ⟪customer_name_1⟫`;
the project note receives the original customer name. The agent hides that name
again in returned text. The mapping stays in the agent's session memory.

This work verifies the agent's path checks and synthetic hook responses on native
Windows. It does not establish that Windows Claude applies every response, that
all disclosure routes are intercepted, or that file access is sandboxed.

Use the [Windows startup guide](windows-startup.md) for prerequisites and the
rules-only agent. No models, dashboard, credentials or paid API calls are needed
for these tests.

## Supported and refused paths

The Windows proposal reviewed in issue #93 supports ordinary filesystem paths in
a local project. The project must be an existing directory. A drive letter is
not proof of local storage: mapped drives and network-mounted project folders
remain unsupported and unverified; this code does not classify drive types.

| Case | Restoration behavior |
| --- | --- |
| Relative path or full drive path inside the project | Allowed for existing local file tools, subject to policy and normal tool permissions |
| Spaces, Unicode, either slash style, drive-letter case variations | Covered on Windows |
| New file or missing normal subfolders | Allowed when the existing ancestor resolves inside the project |
| Ordinary local read outside the project | Keeps the existing read policy; no new project-only read restriction |
| Restored write outside the resolved project, including a similar-prefix sibling or another drive | Refused; a different drive is rejected before filesystem probing |
| Hidden folder, hidden file or protected filename | Refused; Windows protected filename comparisons ignore case |
| `.env`, `.env.local`, similar existing policy exceptions | Allowed inside the project; a hidden parent folder is still refused |
| Trailing space/period, reserved device name, stream such as `file:stream`, recognizable DOS short-name spelling such as `PROTEC~1` | Refused on Windows |
| Drive-relative `C:notes.md` or root-relative `\notes.md` / `/notes.md` | Refused on Windows; use an ordinary relative path or full drive path |
| Parent component `..` in a restored write | Refused on Windows, even when it might normalize back inside; avoids ambiguous link traversal |
| Parent component `..` in a link destination | Refused on Windows before following that destination; use an ordinary absolute link target |
| UNC/network share, device or extended namespace (`\\server\share`, `\\.\...`, `\\?\...`) | Refused on Windows before spelling probes or Edit's content read; applies to paths supplied through placeholders too |
| Directory junction/symlink to an ordinary inside folder | Allowed, with target checks |
| Link outside the project, or into a hidden/protected destination | Refused for restored writes |
| Junction destination naming a network/device namespace | Refused before following that destination; tested with a synthetic readlink response, without contacting a share |
| Broken link, link loop, permission or canonicalization error | Refused; the checker does not fall back to the unresolved spelling |
| Existing file with multiple hard links | Restored writes refused because another name can alias an outside/protected file |
| Missing project root, or a file used as the project root | Restored writes refused |

These checks apply when a call needs placeholder restoration. They do not create
a general file-access policy for calls without placeholders. Both the requested
and resolved write targets are checked for protected locations. An unsafe target
returns a denial without `updatedInput`. Unsupported Windows paths have a short,
fixed explanation; the agent does not echo the hidden value in that explanation.

The shared write checker now requires an established project directory and
rejects broken links, resolution errors and hard-linked files on Unix too. Normal
local-file behavior, the policy allowlist and hook JSON shapes stay the same.
Existing integration fixtures now use real project directories rather than a
nonexistent `/work/project` when testing successful restoration.

## Tool behavior and evidence

The default restoration tools remain `Read`, `Write`, `Edit`, `MultiEdit`,
`NotebookEdit`, `Glob` and `Grep`. Filename spelling selection, literal Grep
escaping, unknown-placeholder refusal, and the existing `.env` exception are
covered. Successful local restoration supplies `updatedInput` without granting
permission: Claude's normal permission flow still applies.

Bash, PowerShell, MCP and unfamiliar tools do not gain automatic restoration.
The existing policy rules for explicitly added tools remain unchanged. Those
rules and shell safety-check behavior were originally investigated on macOS;
their use on Windows is not certified here.

Current [Claude Windows setup](https://code.claude.com/docs/en/setup) and the
[tools reference](https://code.claude.com/docs/en/tools-reference#powershell-tool)
describe a distinct `PowerShell` tool, including availability alongside Bash.
It is not treated as a local file tool. Its returned strings use the agent's
existing unknown-tool checking path. The new test uses a deliberately synthetic
object with stdout, stderr and a nested string; it proves the agent cleans those
strings and preserves their structure, not that Claude accepts that exact shape.

The existing [observed hook fixtures](hook-shapes.md) came from Claude 2.1.302 on
macOS. No new live Windows Claude session, tool capture or real model was run.
Those checks require separate authorization and quota.

## Tests and reproduction

From a prepared PowerShell 7 terminal at the repository root:

```powershell
& .\scripts\windows-dev.ps1
pnpm --filter @safecontext/agent check
pnpm --filter @safecontext/agent lint
pnpm --filter @safecontext/agent test restore restoration-flow app.test
pnpm --filter @safecontext/agent test
pnpm --filter @safecontext/policy check
pnpm --filter @safecontext/policy test
pnpm --filter @safecontext/detectors check
pnpm --filter @safecontext/detectors test
```

Keep real-model opt-ins unset. Do not run `test:e2e` for this offline procedure.

The fixtures create their own temporary directories containing spaces and `José`.
Windows uses real directory junctions; Unix retains directory symlinks. The
outside-project assertion still runs on Windows. Broken links, loops, inside and
outside targets, hidden aliases and a real hard link are covered. Fault injection
checks permission and resolution errors; spies assert no filesystem call for
direct unsupported namespaces. Tests write only synthetic data in their own
temporary project and clean up their fixtures.

The round-trip test learns a synthetic customer value, restores a Write request,
writes the asserted content into the temporary project, and checks PostToolUse
re-hides the returned filename/content. Logs and event reports are checked for
both the value and the project path. This simulates the file tool locally; it
does not launch Claude.

### Results on 2026-11-12

Native Windows, PowerShell 7.6.9, Node 24.22.1 and pnpm 12.14.0:

| Check | Result |
| --- | --- |
| Agent, policy and detector type checks; agent lint | Pass |
| Policy tests | 54 pass |
| Detector tests | 519 pass, 1 existing skip |
| Full model-free agent suite, `--maxWorkers=2` | 502 pass, 5 existing skips, 2 known W5 failures |
| W1 startup/status checks within that suite | All 17 pass |
| Real link boundaries and local write/return privacy flow | Pass; Windows junctions and a hard link exercised |

The first full run at default parallelism also hit the unchanged 10k-term latency
test's 10 ms threshold (16.20 ms p95). Its isolated rerun passed, as did the final
full run limited to two workers. No threshold, test or CI setting was changed.
This is a recorded timing failure under concurrent load, not proof of Windows
production latency. Both W5 failures remain in the final suite.

## Limits to retain in future work

- A hook checks a path before another process performs the operation. A file,
  link or mount can change between those moments. These checks are not atomic
  filesystem containment or protection against a hostile concurrent writer.
- The tests do not certify mapped drives, every reparse-point type, every
  short-name/volume alias, per-directory case-sensitive modes, WSL paths, or
  actual Windows Claude permission-classifier behavior. Do not enable those
  scenarios based only on the ordinary-path test results.
- Windows junction coverage is not proof that this account can create true
  symbolic links. A separate true-directory-symlink capability probe failed with EPERM;
  this task changes neither Windows privileges nor Developer Mode.
- The two existing W5 failures (state-folder location and POSIX cache-permission
  expectation) remain. Neither was skipped or weakened here. Windows credentials
  and cache ACLs are separate work.

Primary API references checked on 2026-11-12: Microsoft's
[file naming and namespace rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file),
Node 24's [path behavior](https://nodejs.org/docs/latest-v24.x/api/path.html), and
[filesystem link APIs](https://nodejs.org/docs/latest-v24.x/api/fs.html#fssymlinktarget-path-type-callback).
