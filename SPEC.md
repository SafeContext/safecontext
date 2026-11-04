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
     │ safe output / block          │                         ──▶ tier 2 small LLM (local, #14/#16)
     └──────────────────────────────┘
                                    │ policy (pull)      ▲ events (metadata only)
                                    ▼                    │
                              apps/dashboard (SvelteKit + Postgres)
```

| Part | Path | Language |
| --- | --- | --- |
| Claude Code plugin (hooks, health check script, status skill) | `plugin/` | JSON, sh |
| Local agent | `apps/agent/` | TypeScript (Node 24, Hono) |
| Shared contracts | `packages/policy/` | TypeScript (Zod 4) |
| Tier 0 detectors | `packages/detectors/` | TypeScript |
| Admin dashboard | `apps/dashboard/` | TypeScript (SvelteKit 3, Tailwind 4, Prisma 7.10, Postgres 18) |
| Models: data, training, evals, export | `ml/` | Python 3.14 (uv) |
| Packaging (not built yet, #26) | `installer/` | Homebrew formula + launchd |

---

## 2. Claude Code hooks (facts from the docs and real runs)

Source: https://code.claude.com/docs/en/hooks. Re-check the docs before relying on details.

What `plugin/hooks/hooks.json` registers today:

| Hook | Matcher | Type | `onFailure` | Our use | What it can do |
| --- | --- | --- | --- | --- | --- |
| `UserPromptSubmit` | none | `http` → `/v1/prompt` | `block` | Check what the user types | **Block** (`decision: "block"` + `reason` shown to the user; `hookSpecificOutput.suppressOriginalPrompt: true` so the prompt isn't echoed back). **Cannot rewrite the prompt**, so a prompt is either blocked or let through unchanged (see #50). Default timeout 30 s; on timeout the prompt proceeds unless `onFailure: "block"`. |
| `PreToolUse` | `*` (every tool, #41) | `http` → `/v1/tool-input` | `block` | Stop data leaving through any tool's input; also the fail-closed gate for tools that read (see §2a) | `permissionDecision` allow/deny/ask/defer; `updatedInput` replaces the **whole** input object. The agent only ever **denies** or passes with no decision. It never answers `allow`, so the user's normal permission prompts still appear, and it doesn't use `updatedInput`. |
| `PostToolUse` | `*` (every tool, #41) | `http` → `/v1/tool-output` | none (can't help, §2a) | Clean what Claude reads from any tool, subagent reports included | `updatedToolOutput` replaces what Claude sees. **Must match the tool's output shape**; for built-in tools a mismatch is **silently ignored** (raw data gets through). Known shapes: `docs/hook-shapes.md` and `apps/agent/src/tool-text.ts` (Read, Bash, Grep, WebFetch, WebSearch, MCP, Agent). Other tools: every string in the result is checked. |
| `SessionStart` | none | `command` | none | Health check: warn if the agent isn't running (#17) | Only `command` and `mcp_tool` hooks (no `http`), so the plugin runs `plugin/scripts/agent-status.sh` (sh + curl). Can't block. `systemMessage` is shown to the user; plain stdout would go to Claude, so it prints nothing when healthy. |

`http` hooks: Claude Code POSTs the hook's JSON input to the agent and reads the same JSON output
schema from a 2xx response body. Non-2xx, connection failure or a non-JSON body = non-blocking
error (the action proceeds) unless `onFailure: "block"`.

Facts found while building (PRs #59, #62, issues #44, #61):
- **The hook URLs are fixed at port 4747.** Claude Code doesn't expand variables in an `http`
  hook's `url` (only in its `headers`), so the plugin can't follow `SC_AGENT_PORT`. The health
  check script does read `SC_AGENT_PORT`. Managed settings (#25) can write any port.
- **`/safe-context:status` only works while the agent is running.** A slash command is a prompt,
  so with the agent down `onFailure: "block"` stops it too. The `SessionStart` warning is what
  tells users the agent is missing.
- **Failed tool calls skip `PostToolUse`.** Claude Code fires `PostToolUseFailure` instead, which
  can't replace the error text. Not handled yet: #44.
- **Background subagent reports arrive through `UserPromptSubmit`**, as a completion notice, so
  they can be blocked but not cleaned. Foreground reports are the `Agent` tool result and are
  cleaned by `PostToolUse`. Open: #61.

`onFailure` needs Claude Code **v2.1.295+**. As of Oct 2026 that's only on the `latest` release channel
(Homebrew cask `claude-code@latest`); `stable` is 2.1.292. CI validates the plugin with 2.1.302.

### 2a. Fail mode (decided: block by default, IT controls it)

Two different failures, handled in two places:

1. **Agent unreachable** (not running, crashed, timed out). Claude Code decides, using the static
   `onFailure: "block"` in `plugin/hooks/hooks.json` on `UserPromptSubmit` and `PreToolUse`.
   `onFailure` on `PostToolUse` can't help: the tool has already run, and Claude would still see the
   raw output. That's why `PreToolUse` matches every tool (`*`), including the ones that only read.
   If the agent is down, the tool is denied before it runs, so no raw output exists.
2. **Agent reachable but can't finish checking** (model error, internal timeout). The agent decides,
   using `Policy.failMode` set by IT on the dashboard (default `block`). With `block`: the agent blocks
   the prompt, denies the tool call, or replaces tool output with a short "withheld: couldn't be
   checked" notice. It must answer well inside Claude Code's timeouts so this path, not (1), applies.
   Built (#9): the agent's time budget per check is `SC_CHECK_BUDGET_MS`, default 8 s, maximum 25 s.
   A tier error, a run-out budget, an invalid request or an invalid reply all apply the fail mode,
   and the reply always keeps the tool's exact output shape. (A tool-output request with no result
   to replace gets a `400`, which Claude Code treats as a non-blocking error.)

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
  the console or MDM, so IT controls fail mode for both cases (1) and (2). **Status:** not built
  (#25); the dashboard's Deploy page is a placeholder.

  Notes:
  - Users see a one-time **security approval dialog** for managed hooks.
  - Changes reach users at their next startup or within an hour.
  - In org mode, don't also enable the plugin's hooks, or every hook runs **twice**.
  - Managed settings are a client-side control, not a security boundary, on unmanaged devices.

Source: https://code.claude.com/docs/en/server-managed-settings

---

## 3. Contracts

Source of truth: `packages/policy` (v1). JSON Schema copies for Python: `packages/policy/schema/`.
Every request and response on both APIs is checked against these schemas.

- **Policy** (`policy.ts`): `version`, data types (each with id, name, description, examples, tier
  green/yellow/red and action allow, generalize, pseudonymize, mask, block), admin term lists and
  `failMode` (default `block`). Only green types may `allow`. `defaultPolicy()` has version 0
  ("never published") and the 10 default data types in `defaults.ts`. The dashboard writes it; the
  agent pulls it, keeps the highest version it has seen, caches it on disk and works offline.
- **Agent API** (`api.ts`; binds `127.0.0.1` only; port from `SC_AGENT_PORT`, default 4747, but
  the plugin's hook URLs are fixed at 4747, see §2):
  - `GET /health`: `{ ok, policyVersion }`
  - `POST /v1/prompt`: body = `UserPromptSubmit` input, response = its hook output
  - `POST /v1/tool-input`: body = `PreToolUse` input, response = its hook output
  - `POST /v1/tool-output`: body = `PostToolUse` input, response = its hook output
- **Dashboard API for the agent** (`dashboard-api.ts`, built in #21, used by the agent's sync in #22).
  JSON bodies; errors are `ApiError` with a code (`unauthorized`, `device_mismatch`, `no_policy`,
  `bad_request`, `invalid_body`, `rate_limited`) and never echo request values back.
  - `POST /api/devices`: auth = the organisation's **enrollment key** (a placeholder, #51). Body
    `{ deviceId }`; returns a device token. Registering the same id again issues a new token. The
    dashboard stores only a SHA-256 hash of keys and tokens; the agent keeps its token in the
    macOS Keychain.
  - `GET /api/policy`: auth = device token. The latest published policy with an `ETag`;
    `If-None-Match` gives `304`. No policy published yet: `404 no_policy` (the agent keeps its
    cached or default policy).
  - `POST /api/events`: auth = device token. An `AgentEventBatch` of 1–500 events, stored
    all-or-nothing. Every event must name the authenticated device. Each stored event sends a
    Postgres `NOTIFY` on `safecontext_events` (metadata only), which feeds the live feed.
  - Rate limits (in memory, per server process): registration 10/min per IP, failed auth 20/min
    per IP, policy 30/min per device, events 60/min per device. Over the limit: `429` + `Retry-After`.
  - Known gap: no idempotency key, so a retried upload can be stored twice (PR #49).
- **AgentEvent** (`events.ts`, agent → dashboard, strict: any extra field rejects the batch): `ts`,
  `deviceId` (anonymised), `policyVersion`, `hookEvent`, `toolName` (absent for prompts), `counts`
  per data type id, `actions` per action, `blocked`, `latencyMs`. Counts and `policyVersion` are
  integers up to `MAX_EVENT_INT` (2,147,483,647, Postgres `integer`); larger values are rejected,
  not truncated. **Never any prompt, file or tool text.** `blocked` is true only when the prompt or
  tool call was blocked, or tool output was withheld in full (PR #52).
- **Dashboard only:** `GET /live-feed` streams new events to the Overview page as server-sent
  events (#24). Each row is a strict `FeedEvent` (id, times, hook, tool, device id, result).

---

## 4. Classifier: three tiers

Each tier runs only if the previous one isn't sure.

| Tier | Catches | Approach | Target latency | Status |
| --- | --- | --- | --- | --- |
| 0. Rules + lists | Secrets/API keys, emails, card numbers (Luhn), phone numbers, IP addresses, admin term lists (codenames, customers) | Regex rules (a subset of the Gitleaks rule set) + a single Aho-Corasick pass for term lists (whole words, any case) | < 10 ms | Built (#7, #8, wired in #63). 10k terms over 5 KB: ~0.2 ms (PR #47). |
| 1. Label tagger | Spans for the admin's own data types ("Revenue figures", "Customer names") | GLiNER ONNX export run with `onnxruntime-node` in the agent's own process (no Python sidecar) | ~50–200 ms | Built (#13 model, #15 agent). Off unless `SC_TIER1_MODEL_DIR` is set. |
| 2. Small LLM | Context-dependent judgements (roadmap vs press release) and rewriting ("$4.2M, up 18%" → "mid-teens growth") | Small open model behind an OpenAI-compatible local API, default Ollama ([decided in #14](https://github.com/SafeContext/safecontext/issues/14#issuecomment-6588926437)). Compare current Qwen / Gemma / Llama / Phi releases, small (up to ~4B) and medium (up to ~8B); prefer Apache-2.0 licences | ~1–5 s | Built (#14 model and prompts, #16 agent). Off unless `SC_TIER2_MODEL` or `SC_TIER2_BASE_URL` is set. |

**Names are not sensitive (decided on #2, built in #78).** No tier tags a person's name as such:
*Customer personal data* is contact and account details, and tier 1 was retrained on data where
names (staff, customers, chat handles, public datasets' name and user name entities) are not
spans. Its label for that type is "email, phone, address, card or id number" (`labels.json`),
not the type's name. To protect specific people, IT lists their names on a term list under any
data type (tier 0). When spans of two data types overlap, the stricter type in the policy wins
(red over yellow over green, then action), whichever tier found them.

**Tier 1 as built (#13, #15).**
- **Model:** `urchade/gliner_small-v2.1` (Apache-2.0), fine-tuned on our train split. Chosen in
  [#13](https://github.com/SafeContext/safecontext/issues/13#issuecomment-6461207888). The licence of its base training data (`urchade/pile-mistral-v0.1`) has not
  been reviewed yet.
- **Labels:** one per data type, from `labels.json` in the export (`{ dataTypeId: label }`); types
  missing there use `SC_TIER1_LABEL` (default the type's name). **Threshold 0.6**, from the
  export's `tier1.json`, chosen on dev.
- **Scores** (retrained in #78 so names aren't flagged) on the full frozen test split (29,018
  records, sha `dfe667ab…`): red recall **97.8%** (target ≥ 95%), micro F1 97.9%, safe text
  flagged 7.7%, hard negatives flagged 25.3%. Macrohard red recall is 89.9%, because long
  secrets are only partly caught; tier 0 is relied on to catch them whole. On the realistic
  `llm-test` set: safe documents flagged 38.3% (83.0% before #78), red recall 74.8%.
  Macrohard data is template-only so far, so the business labels' scores are an upper bound.
- **Latency** (ONNX, CPU, idle M3 Max, one text per call): p50 40 ms, p95 256 ms; about
  75–110 ms per KB for longer text. Not yet measured on a base M-series Mac.
- **When it runs:** only for data types whose action isn't `allow`. It is skipped when there is no
  text, and for a prompt or tool call that tier 0 already blocks. Tool output always gets tier 1.
  Long text is split into overlapping windows; the check budget (§2a) still applies.
- **Hosting:** the export lives in a private Hugging Face org (§4a).

**Tier 2 as built (#14, #16).**
- **Model:** Gemma 4 E4B instruct, `gemma4:e4b-it-q4_K_M` on Ollama with `OLLAMA_CONTEXT_LENGTH=8192`,
  pinned with its digest in `ml/models.lock.json` (`external`, `tier2-llm`). Scores and the
  comparison with other models: `ml/results/tier2-llm.md`.
- **API:** OpenAI-compatible `POST <base>/chat/completions` (`SC_TIER2_BASE_URL`, default
  `http://127.0.0.1:11434/v1`). Non-streaming, `temperature: 0`, `seed: 0`, `reasoning_effort:
  "none"`, the task's JSON Schema as `response_format`. The answer is still checked on the way
  back. An optional `SC_TIER2_API_KEY` is sent as a Bearer header, so a company-hosted server (#75)
  is a setting. The base URL must be https unless it is loopback.
- **Prompts:** the agent loads `ml/prompts/tier2/` (`SC_TIER2_PROMPTS_DIR`), the files the
  evaluation scored. `apps/agent/src/classifier/tier2/prompts.ts` ports the Python rendering
  exactly; a fixture written by the Python reference checks it.
- **Context judgement** (the last classifier tier): tier 1 spans of the labels in `tier2.json`
  (`unreleased-roadmap`, `revenue-figures`, `internal-metrics`, `deal-sizes`) go to the model,
  which says whether each is sensitive *in this document*. Spans it says aren't are removed. The
  classifier only lets tier 2 remove tagger spans of those labels. It never removes a tier 0 rule
  or term-list match, or a span overlapping one. For a prompt or tool input, tier 2 runs only
  if it could change the verdict.
- **Fail safe:** each call is capped at 6 s and at the time left in the check. No call starts with
  less than 1.5 s left (`tier2.json` `timeouts`); tier 2 is then skipped, not failed. A timeout,
  connection error, bad JSON, or a missing or repeated id keeps that call's spans flagged. Tier 2
  never fails a check by itself.
- **Startup:** on Ollama, `GET /api/tags` checks the model and digest, then one warm-up call.
  Logs `tier2_ready` or `tier2_unavailable` with a reason. The agent never pulls a model.
- **Latency** (M3 Max, tiers 0+1+2, per check that needs tier 2): p50 ~0.5 s, p95 ~0.85 s with
  the GPU free; 3–5 s when another app was using the GPU. Not yet measured on a base Mac.

**Transformations** (built in #10, `apps/agent/src/transform/`):
- **generalize** (vague but true, #16). A span that is one number gets a deterministic rewrite
  (`transform/numbers.ts`, a port of `ml/.../tier2/numbers.py`): `$4.2M` → `over $4M`, `18%` →
  `high teens`. It is true by construction and scored 100% clean in #14. Other values (names,
  codenames, dates) go to tier 2's generalize prompt ("an upcoming project"). Every rewrite must
  pass a leak check: it can't repeat the value, a distinctive word of it, or another flagged
  value in the text, and it must be short and plain. Otherwise, or without tier 2, the value
  becomes its data type's name in brackets, e.g. `[Revenue figures]`.
- **pseudonymize**: a stand-in named after the data type id, e.g. `customer_name_1` or
  `customer_personal_data_1`, consistent within a Claude Code session so Claude can still tell
  items apart. Stand-ins are not mapped back in tool input (#50).
- **mask**: `****4242`. The last 4 characters show only if the value is at least 12 long.
- **block**: `[Safe Context removed: <data type name>]`.

Tool output is always cleaned span by span. Prompts and tool inputs can't be edited (§2), so they
are blocked or passed whole. **Temporary rule (#50):** only red data, or a data type whose action
is `block`, stops them; yellow data goes through unchanged. The rule is one function,
`stopsPromptsAndToolCalls` in `apps/agent/src/decide.ts`. A blocked prompt's message offers a
cleaned version the user can send instead.

**Evaluation (`ml/`, harness built in #12, dataset in #11):**
- Per-label precision/recall; **red recall ≥ 95%** (the pitch's riskiest-claim target)
- False-positive rate on safe text (over-redacting kills usefulness)
- p50/p95 latency on an Apple Silicon Mac
- **Task-preservation score:** an LLM judge checks whether Claude still solves the task from the
  cleaned version. Built, not yet run. Per #14, judge runs go through the local `claude -p` CLI,
  kept small, after Joe OKs them; total paid API spend is capped at $5.
- Data: public PII datasets (licence-checked; see `ml/data/LICENCES.md`) + a synthetic "Macrohard"
  corpus (launch reviews, incident logs, Slack threads, code with secrets), with hard negatives
  (press release vs roadmap). The test split is frozen. The Claude-written Macrohard data has not
  been generated (PR #54 asks for approval).

### 4a. Models and data hosting (decided in #70, built in PR #71)

Weights, exports and dataset splits never go in git. They live in the private Hugging Face org
`SafeContext`: model `SafeContext/tier1-gliner` (ONNX export at the root, fine-tuned PyTorch
model under `pytorch/`) and dataset `SafeContext/safecontext-data` (`splits/`).
`ml/models.lock.json` pins each artifact to an exact commit with the sha256 and size of every
file; changing a model is a normal PR. `pnpm models:pull` downloads and verifies them. Each person
uses their own Hugging Face token. Tier 2: an off-the-shelf model is pinned by name and version
only; weights are hosted only if we fine-tune.

---

## 5. Done when

| Part | Done when | Status (2 Nov 2026) |
| --- | --- | --- |
| Plugin + hooks | An automated run (`claude -p --output-format stream-json`) shows raw data reaching Claude without the plugin, and with the plugin: unsafe prompts blocked; Read/Bash/Grep/WebFetch output cleaned. `claude plugin validate ./plugin` passes. | Mostly met. `pnpm test:e2e` (#17, #41) shows the block and cleaned Read and Bash output, including inside subagents. Grep, WebFetch, WebSearch and MCP are covered by unit tests on real payloads, not the e2e run (WebFetch can't fetch a local page). CI runs `claude plugin validate`. |
| Agent | Every endpoint returns valid hook JSON (validated against `packages/policy`). Tiers 0+1 p95 < 300 ms on a Mac. Fail-mode behaviour covered by tests. | Endpoints and fail mode built and tested (#9). Tier 1 inside the target on an M3 Max (PR #67, measured on a busy machine); large tool output is slower (~100 ms per KB). Base M-series Mac not measured. |
| Classifier | Meets the evaluation targets above on the held-out set. | Tier 1 meets red recall ≥ 95% (97.8%). Task preservation not run yet. Tier 2 (#14, #16) clears tier 1's roadmap-vs-press-release false positives (52% → 0% on test) without losing a true span. |
| Installer | On a clean Mac, one command + `/plugin install` gives a working setup. The SessionStart check tells the user how to fix a missing agent. | SessionStart check built (#17). Installer not started (#26). |
| Dashboard | Moving a data type between columns updates the policy; the agent picks it up within N seconds. Live feed shows events and contains no text. | Live feed built (#24). Agent pulls the policy every 30 s (#22). Policy editor not built (#23). |

---

## 6. Verify first (could break the design)

All four were checked in spikes. Results:

1. `updatedToolOutput` shape for each tool we clean (Read, Bash, Grep, WebFetch, WebSearch, MCP).
   Write a test per tool proving the replacement is applied, not ignored.
   **Done (#3):** `docs/hook-shapes.md`, fixtures in `packages/policy/fixtures/hooks/`. A wrong
   shape is silently ignored; MCP accepts any shape. The `Agent` shape was added in #41.
2. Whether `@file` mentions, CLAUDE.md files, images/PDFs and **subagent** tool calls pass through our hooks.
   **Done (#4):** `docs/hook-coverage.md`. Subagent tool calls pass through the hooks, and since
   #41 the subagent's report is cleaned too (foreground only, #61). Open gaps: #38, #39, #40, #42, #44, #61.
3. `http` hook behaviour and latency end to end.
   **Done (#3):** localhost round trip median 2 ms, p95 6 ms, before classifier time.
4. GLiNER in `onnxruntime-node`: export works, accuracy matches Python, speed OK.
   **Done (#5, then #15):** same spans and scores as Python gliner on the spike's samples. The
   stock int8 export was not accurate enough, so the agent uses fp32.

---

## 7. Open decisions (ask the team; don't guess)

Each item says where it was decided, or which issue holds the open question.

1. ~~Fail mode~~: **decided**, block by default, IT-controlled. See §2a.
2. ~~Auth library~~: **decided**, Better Auth with its Prisma 7 adapter (not installed yet). Still
   **open:** sign-in methods for v1 (email/password, Google, company SSO via Better Auth's SSO
   plugin): #19.
3. **Data type taxonomy v0**: which green/yellow/red types ship by default. **Partly open.** The 10
   types proposed in [#2](https://github.com/SafeContext/safecontext/issues/2#issuecomment-6245163595)
   shipped in PR #28 (`packages/policy/src/defaults.ts`), but no approval or answers to that
   comment's three questions are recorded in #2. ~~Whose names are sensitive~~: **decided** on #2
   (Joe, 3 Nov 2026): **people's names are not sensitive**, staff or customers, chat handles
   included. *Customer personal data* is contact and account details only (emails, phones,
   postal addresses, card and account numbers, government IDs); *Customer names* (client
   companies) is unchanged. IT protects specific names with a term list. Built in #78. Still
   open: special-category data and public reference customers (PR #54).
4. **Laptop vs central server** for the model (start on the laptop; keep the agent API identical).
   **Open:** #75 (later; Gemma on every Mac for now). Everything built so far runs on the laptop;
   tier 2's endpoint is already a setting (`SC_TIER2_BASE_URL`, `SC_TIER2_API_KEY`).
5. **Agent distribution**: Homebrew formula + launchd; how to package Node + models (and Ollama, if
   used). **Open:** #26. Model hosting is decided (item 8).
6. **Minimum Claude Code version** (≥ 2.1.295 if we rely on `onFailure`). **Open.** #38 would raise it
   to 2.1.299 for `CLAUDE_CODE_DISABLE_FILE_MENTIONS`.
7. ~~Tier 2 model and runtime~~: **decided** in
   [#14](https://github.com/SafeContext/safecontext/issues/14#issuecomment-6588926437) (runtime:
   OpenAI-compatible API, default Ollama) and PR #74 (model: Gemma 4 E4B). Built in #16. See §4.
   Still **open** in #14: what to do on 16 GB Macs (the model holds ~7 GB while loaded). Also open:
   whether to keep it loaded all the time (`OLLAMA_KEEP_ALIVE`). Where tier 2 runs, each Mac or a
   company server, is **open** in #75 (item 4).
8. ~~Model and dataset hosting~~: **decided** in #70, a private Hugging Face org. See §4a.
9. ~~Tier 1 model~~: **decided** in
   [#13](https://github.com/SafeContext/safecontext/issues/13#issuecomment-6461207888), GLiNER
   small v2.1 fine-tuned. See §4.
10. **Yellow data in prompts and tool inputs** (allow or block?), and mapping stand-ins back in tool
    input. **Open:** #50. Temporary rule in §4.
11. **How devices join an organisation** (enrollment key is a placeholder). **Open:** #51.
12. **Hook coverage gaps.** **Open:** `@file` mentions #38, CLAUDE.md and memory files #39, images
    and PDFs #40, slash commands and skills #42, failed tool calls #44, background subagent
    reports #61.
