# Safe Context: build spec

Safe Context lets employees use AI coding tools on real work without leaking company data.
A company-run model checks every prompt a user sends and cleans every file or tool result
before Claude sees it, following a policy that IT controls from a dashboard.

Scope for now: **Claude Code only, macOS (Apple Silicon) only.**

---

## 1. How it fits together

```
 Claude Code ──(http hooks)──▶ apps/agent (localhost:4747) ──▶ tier 0 rules + lists
     ▲                              │                         ──▶ tier 1 label tagger (GLiNER)
     │ safe output / block          │                         ──▶ tier 2 small LLM (Ollama/MLX)
     └──────────────────────────────┘
                                    │ policy (pull)      ▲ events (metadata only)
                                    ▼                    │
                              apps/dashboard (SvelteKit + Postgres)
```

| Part | Path | Language |
| --- | --- | --- |
| Claude Code plugin (hooks) | `plugin/` | JSON |
| Local agent | `apps/agent/` | TypeScript (Node 24, Hono) |
| Shared contracts | `packages/policy/` | TypeScript (Zod 4) |
| Tier 0 detectors | `packages/detectors/` | TypeScript |
| Admin dashboard | `apps/dashboard/` | TypeScript (SvelteKit 3, Tailwind 4, Prisma 7.10, Postgres 18) |
| Models: data, training, evals, export | `ml/` | Python 3.14 (uv) |
| Packaging | `installer/` | Homebrew formula + launchd |

---

## 2. Claude Code hooks (facts from the docs)

Source: https://code.claude.com/docs/en/hooks. Re-check the docs before relying on details.

| Hook | Our use | What it can do |
| --- | --- | --- |
| `UserPromptSubmit` | Check what the user types | **Block** (`decision: "block"` + `reason` shown to the user; set `hookSpecificOutput.suppressOriginalPrompt: true` so the prompt isn't echoed back). **Cannot rewrite the prompt.** Default timeout 30 s; on timeout the prompt proceeds unless `onFailure: "block"`. |
| `PreToolUse` | Stop secrets leaving (Bash, WebFetch, WebSearch, MCP); also the fail-closed gate for Read/Grep (see §2a) | `permissionDecision` allow/deny/ask/defer; `updatedInput` replaces the **whole** input object. |
| `PostToolUse` | Clean what Claude reads (Read, Bash, Grep, WebFetch, WebSearch, MCP) | `updatedToolOutput` replaces what Claude sees. **Must match the tool's output shape**; for built-in tools a mismatch is **silently ignored** (raw data gets through). |
| `SessionStart` | Health check: warn if the agent isn't running | Not implemented yet. Confirm the output fields in the docs first. |

Hooks are `type: "http"`: Claude Code POSTs the hook's JSON input to the agent and reads the
same JSON output schema from a 2xx response body. Non-2xx, connection failure or a non-JSON
body = non-blocking error (the action proceeds) unless `onFailure: "block"`.

`onFailure` needs Claude Code **v2.1.295+**. As of Oct 2026 that's only on the `latest` release channel
(Homebrew cask `claude-code@latest`); `stable` is 2.1.292.

### 2a. Fail mode (decided: block by default, IT controls it)

Two different failures, handled in two places:

1. **Agent unreachable** (not running, crashed, timed out). Claude Code decides, using the static
   `onFailure: "block"` in `plugin/hooks/hooks.json` on `UserPromptSubmit` and `PreToolUse`.
   `onFailure` on `PostToolUse` can't help: the tool has already run, and Claude would still see the
   raw output. That's why `PreToolUse` also matches Read and Grep. If the agent is down, the tool is
   denied before it runs, so no raw output exists.
2. **Agent reachable but can't finish checking** (model error, internal timeout). The agent decides,
   using `Policy.failMode` set by IT on the dashboard (default `block`). With `block`: the agent blocks
   the prompt, denies the tool call, or replaces tool output with a short "withheld: couldn't be
   checked" notice. It must answer well inside Claude Code's timeouts so this path, not (1), applies.

### 2b. Two ways to install: plugin (individuals) and managed settings (organisations)

Case 1 above is controlled by `onFailure` in whichever hooks config is active.

- **Individuals / pilots: the plugin.** `plugin/hooks/hooks.json` is static, so it's always `block`.
- **Organisations: Claude Code managed settings.** Hooks can be delivered org-wide through managed
  settings, with the same JSON format as `settings.json`, and users can't override them:
  - **Server-managed:** pasted by an Owner into claude.ai **Organization settings > Claude Code >
    Managed settings** (Claude Teams/Enterprise). Clients fetch at startup and **hourly**. Only the
    console is documented; there is no documented API, so we can't push it automatically.
  - **Endpoint-managed:** `managed-settings.json` or an MDM profile (Jamf/Intune), for orgs with device
    management.

  **Dashboard feature:** a "Deploy to Claude Code" page generates that managed-settings JSON from the
  current policy: the Safe Context `http` hooks, `onFailure` set from `Policy.failMode`, and optionally
  `forceRemoteSettingsRefresh: true` so Claude Code won't start without the org policy. IT copies it into
  the console or MDM, so IT controls fail mode for both cases (1) and (2).

  Notes:
  - Users see a one-time **security approval dialog** for managed hooks.
  - Changes reach users at their next startup or within an hour.
  - In org mode, don't also enable the plugin's hooks, or every hook runs **twice**.
  - Managed settings are a client-side control, not a security boundary, on unmanaged devices.

Source: https://code.claude.com/docs/en/server-managed-settings

---

## 3. Contracts

Source of truth: `packages/policy` (v1). JSON Schema copies for Python: `packages/policy/schema/`.

- **Policy**: data types, each with id, name, description, examples, tier (green/yellow/red) and
  action (allow, generalize, pseudonymize, mask, block). Plus admin term lists and `failMode`.
  The dashboard writes it; the agent pulls and caches it, and works offline.
- **Agent API** (binds `127.0.0.1` only; port from `SC_AGENT_PORT`, default 4747):
  - `GET /health`
  - `POST /v1/prompt`: body = `UserPromptSubmit` input, response = its hook output
  - `POST /v1/tool-input`: body = `PreToolUse` input, response = its hook output
  - `POST /v1/tool-output`: body = `PostToolUse` input, response = its hook output
- **AgentEvent** (agent → dashboard): timestamp, anonymised device id, hook event, tool,
  counts per data type, counts per action, blocked, latency. **Never any prompt, file or tool text.**

---

## 4. Classifier: three tiers

Each tier runs only if the previous one isn't sure.

| Tier | Catches | Approach | Target latency |
| --- | --- | --- | --- |
| 0. Rules + lists | Secrets/API keys, emails, card numbers (Luhn), phone numbers, admin term lists (codenames, customers) | Regex rules (consider porting the gitleaks rule set) + exact match | < 10 ms |
| 1. Label tagger | Spans for the admin's own data types ("Revenue figures", "Customer names") | GLiNER (takes arbitrary label names). Run an ONNX export via `onnxruntime-node` from TS; fall back to a Python sidecar only if needed | ~50–200 ms |
| 2. Small LLM | Context-dependent judgements (roadmap vs press release) and rewriting ("$4.2M, up 18%" → "mid-teens growth") | Small open model (1–8B) via Ollama or MLX. Compare current Qwen / Gemma / Llama / Phi releases; prefer Apache-2.0 licences | ~1–5 s |

**Transformations:** generalize (vague but true), pseudonymize (`customer_1`, consistent within a
session so Claude can still tell items apart), mask (`****4242`), block.

**Evaluation (`ml/`):**
- Per-label precision/recall; **red recall ≥ 95%** (the pitch's riskiest-claim target)
- False-positive rate on safe text (over-redacting kills usefulness)
- p50/p95 latency on an Apple Silicon Mac
- **Task-preservation score:** an LLM judge checks whether Claude still solves the task from the cleaned version
- Data: public PII datasets (check licences; some are non-commercial) + a synthetic "Macrohard" corpus
  (launch reviews, incident logs, Slack threads, code with secrets), with hard negatives
  (press release vs roadmap)

---

## 5. Done when

| Part | Done when |
| --- | --- |
| Plugin + hooks | An automated run (`claude -p --output-format stream-json`) shows raw data reaching Claude without the plugin, and with the plugin: unsafe prompts blocked; Read/Bash/Grep/WebFetch output cleaned. `claude plugin validate ./plugin` passes. |
| Agent | Every endpoint returns valid hook JSON (validated against `packages/policy`). Tiers 0+1 p95 < 300 ms on a Mac. Fail-mode behaviour covered by tests. |
| Classifier | Meets the evaluation targets above on the held-out set. |
| Installer | On a clean Mac, one command + `/plugin install` gives a working setup. The SessionStart check tells the user how to fix a missing agent. |
| Dashboard | Moving a data type between columns updates the policy; the agent picks it up within N seconds. Live feed shows events and contains no text. |

---

## 6. Verify first (could break the design)

1. `updatedToolOutput` shape for each tool we clean (Read, Bash, Grep, WebFetch, WebSearch, MCP).
   Write a test per tool proving the replacement is applied, not ignored.
2. Whether `@file` mentions, CLAUDE.md files, images/PDFs and **subagent** tool calls pass through our hooks.
3. `http` hook behaviour and latency end to end.
4. GLiNER in `onnxruntime-node`: export works, accuracy matches Python, speed OK.

---

## 7. Open decisions (ask the team; don't guess)

1. ~~Fail mode~~: **decided**, block by default, IT-controlled. See §2a.
2. ~~Auth library~~: **decided**, Better Auth with its Prisma 7 adapter (not installed yet). Still to
   decide: sign-in methods for v1 (email/password, Google, company SSO via Better Auth's SSO plugin).
3. **Data type taxonomy v0**: which green/yellow/red types ship by default.
4. **Laptop vs central server** for the model (start on the laptop; keep the agent API identical).
5. **Agent distribution**: Homebrew formula + launchd; how to package Node + models (and Ollama, if used).
6. **Minimum Claude Code version** (≥ 2.1.295 if we rely on `onFailure`).
