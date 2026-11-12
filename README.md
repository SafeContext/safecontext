# Safe Context

Use AI. Keep the secrets. Safe Context checks Claude Code prompts and cleans tool output with a
company-run model, following a policy IT controls from a dashboard.

- **Architecture, contracts, open decisions:** [SPEC.md](SPEC.md)
- **Rules for coding agents:** [CLAUDE.md](CLAUDE.md)
- **Roadmap and what's next:** [issue #1](https://github.com/SafeContext/safecontext/issues/1)
- **Windows work branch (rules-only developer setup):** [startup and offline checks](docs/windows-startup.md)

## What it is

Safe Context has three parts:

- **A Claude Code plugin.** It sends every prompt the user types, and every tool Claude uses, to
  a small program on the same Mac before Claude sees it.
- **The agent.** That small program. It looks for sensitive data, such as API keys, customer
  emails or project codenames. It blocks a prompt that holds "never share" data, and it hides
  what Claude reads from files and commands behind labelled placeholders: a customer email becomes
  `⟪customer_personal_data_1⟫`, a secret `⟪secret_1⟫`, a card number `⟪customer_personal_data_2: ****4242⟫`.
  The agent keeps the real values on the Mac and puts them back when Claude reads or writes a file
  in the project, so a file Claude writes holds the real email address even though Claude only ever
  saw the placeholder ([#83](https://github.com/SafeContext/safecontext/issues/83)).
- **The dashboard.** A website where IT sets the rules (the "policy") and sees counts of what was
  checked. The agent never sends it any text, only counts and timings.

Scope for now: Claude Code only, macOS on Apple Silicon only. This is a pilot under construction.
Nothing here is packaged for end users yet.

## What works today

The agent checks text in up to three steps ("tiers"). Each step runs only if the one before
hasn't settled the result.

| Tier | What it finds | Status |
| --- | --- | --- |
| 0. Rules and word lists | Secrets and API keys, emails, phone numbers, card numbers and IP addresses. Plus the word lists IT uploads (codenames, customer names). | Built and on by default ([#7](https://github.com/SafeContext/safecontext/issues/7), [#8](https://github.com/SafeContext/safecontext/issues/8), [#63](https://github.com/SafeContext/safecontext/issues/63)). |
| 1. Tagger | The company's own kinds of data, such as customer names or revenue figures, that fixed rules miss. A small AI model (GLiNER) fine-tuned on our own example data. | Built ([#13](https://github.com/SafeContext/safecontext/issues/13), [#15](https://github.com/SafeContext/safecontext/issues/15)). Off unless you point the agent at the model. On our held-out test set it finds 97.8% of "never share" items and wrongly flags 7.7% of harmless texts. On realistic Claude-written documents it flags 38% of safe ones (was 83% before names stopped counting as sensitive, [#78](https://github.com/SafeContext/safecontext/issues/78)). |
| 2. Small local LLM | Judgements that need context: a codename in a launch plan is secret, the same codename in a press release isn't. It also rewrites names and dates to be vague ("an upcoming project"). | Built ([#14](https://github.com/SafeContext/safecontext/issues/14) chose Gemma 4 E4B on Ollama, [#16](https://github.com/SafeContext/safecontext/issues/16) wired it in). Off unless you turn it on. It can only *un-flag* tier 1 finds for roadmap, revenue, metrics and deal sizes. It never un-flags secrets or IT's word lists. If it's slow or down, everything stays flagged. |

"Make it vague" adds a true hint to the placeholder. Numbers don't need tier 2: `$4.2M` becomes
`⟪revenue_figure_1: over $4M⟫` and `18%` gets `high teens`. These are always true and never repeat
the value. Names and dates need tier 2. Without it (or if its answer could give the value away) the
placeholder has no hint.

**Default data types** (`packages/policy/src/defaults.ts`; IT can move any of them or add its own):

| Traffic light | Data types |
| --- | --- |
| 🟢 Safe to share | Public docs, release notes, open-source code |
| 🟡 Make it vague | Revenue figures, internal metrics, deal sizes, customer names (which companies are clients) |
| 🔴 Never share | Unreleased roadmap, API keys & secrets, customer personal data |

**People's names are not sensitive** (decided on
[#2](https://github.com/SafeContext/safecontext/issues/2), built in
[#78](https://github.com/SafeContext/safecontext/issues/78)). A colleague's or customer's name,
or a chat handle such as `priya`, goes through unchanged. *Customer personal data* means contact
and account details: emails, phone numbers, postal addresses, card and account numbers, and
government IDs. To protect specific people (executives, say), IT adds their names to a word
list under any data type. When two data types match the same text, the stricter one wins.

Also working:

- The plugin checks **every** tool, including subagents
  ([#41](https://github.com/SafeContext/safecontext/issues/41)).
- When Claude Code starts, the plugin warns if the agent isn't running. `/safe-context:status`
  shows the policy version the agent enforces
  ([#17](https://github.com/SafeContext/safecontext/issues/17)).
- If the agent is down or can't finish a check, prompts and tool calls are blocked by default.
- The agent can sign up with the dashboard, pull the policy every 30 seconds, keep a copy on
  disk, and upload counts ([#21](https://github.com/SafeContext/safecontext/issues/21),
  [#22](https://github.com/SafeContext/safecontext/issues/22)).
- The dashboard's Overview page shows the last 7 days' counts and a live feed
  ([#24](https://github.com/SafeContext/safecontext/issues/24)). The Policy, Deploy and
  Settings pages are placeholders.

## Known gaps

- **Dashboard sign-in is email + password only** ([#19](https://github.com/SafeContext/safecontext/issues/19)).
  Admins are added with a script (`create-admin`), not from the dashboard. Google and company SSO
  are not decided yet.
- **No policy editor** ([#23](https://github.com/SafeContext/safecontext/issues/23)) and **no
  "Deploy to Claude Code" page** ([#25](https://github.com/SafeContext/safecontext/issues/25)).
- **No installer** ([#26](https://github.com/SafeContext/safecontext/issues/26)). You run the agent
  from this repo.
- **"Make it vague" data in prompts and tool calls goes through unchanged.** Claude Code can only
  block a prompt, not edit it. For now only "never share" data blocks. This is temporary until
  [#50](https://github.com/SafeContext/safecontext/issues/50) is decided.
- **Ways data can reach Claude without passing through the checks:**
  - `@file` mentions ([#38](https://github.com/SafeContext/safecontext/issues/38))
  - CLAUDE.md and memory files ([#39](https://github.com/SafeContext/safecontext/issues/39))
  - images and PDFs ([#40](https://github.com/SafeContext/safecontext/issues/40))
  - slash commands and skills ([#42](https://github.com/SafeContext/safecontext/issues/42))
  - error text from failed tool calls ([#44](https://github.com/SafeContext/safecontext/issues/44))
  - background subagent reports, which are checked but can only be blocked, not cleaned
    ([#61](https://github.com/SafeContext/safecontext/issues/61))

  Details: [docs/hook-coverage.md](docs/hook-coverage.md).
- **Tier 2 speed varies.** A check that needs tier 2 took about 0.5 s (p50) on an M3 Max when the
  graphics chip was free, and 3–5 s when another app was using it. A call that runs out of time
  keeps everything flagged. Not measured on a base 16 GB Mac yet; #14 estimates 1.7–2 s there.
- **How a Mac joins an organisation** uses a temporary enrollment key
  ([#51](https://github.com/SafeContext/safecontext/issues/51)).

---

## Setup (macOS, Apple Silicon)

Requires Node 24 (nvm), pnpm 12, uv, PostgreSQL 18, and Claude Code **2.1.295 or later** (the
plugin's `onFailure: "block"` needs it).

```bash
nvm use
pnpm install
createdb safecontext                                  # local database
cp apps/dashboard/.env.example apps/dashboard/.env    # then set DATABASE_URL and BETTER_AUTH_SECRET
pnpm --filter @safecontext/dashboard db:generate
```

## Try it locally

**Quickest way to try it by hand:** the [SafeContext/MacroHard](https://github.com/SafeContext/MacroHard)
repo, a made-up company whose three people (dev, PM, sales) each have a folder of realistic work
files where Safe Context is on, from the terminal or the desktop app. `demo/start-agent.sh` runs
the agent with every tier; see [demo/README.md](demo/README.md). The steps below set each piece up by hand.

### 1. Agent and plugin

```bash
pnpm --filter @safecontext/agent dev        # agent on http://127.0.0.1:4747 (tier 0 only)
claude --plugin-dir ./plugin                # in another terminal: Claude Code with Safe Context
```

In Claude Code, `/safe-context:status` should say the agent is running. Without a dashboard the
agent uses the built-in default policy (version 0), or a policy file named by `SC_POLICY_FILE`.

The plugin always calls port 4747: Claude Code doesn't expand variables in an `http` hook's URL.

### 2. Turn on tier 1

The tier 1 model is about 600 MB and lives in a private Hugging Face organisation, `SafeContext`
([#70](https://github.com/SafeContext/safecontext/issues/70)). Ask an org admin to invite your
Hugging Face account, then log in with a token that can read the org's repos:

```bash
cd ml && uv run hf auth login && cd ..
pnpm models:pull                            # downloads the pinned model and dataset, checks sha256
```

`ml/models.lock.json` pins the exact version of each file. Then start the agent with the model.
Use an absolute path: a relative one is read from `apps/agent`, the agent's working directory.

```bash
SC_TIER1_MODEL_DIR="$PWD/ml/models/tier1-onnx" pnpm --filter @safecontext/agent dev
```

### 3. Turn on tier 2

Tier 2 is Gemma 4 E4B (Apache-2.0, about 6.6 GB on disk and 7 GB of memory while loaded), run by
[Ollama](https://ollama.com) on this Mac. Install and start Ollama with an 8k context, then pull the
pinned model once:

```bash
brew install ollama
OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_FLASH_ATTENTION=1 ollama serve &   # keep it running
ollama pull gemma4:e4b-it-q4_K_M
```

Then start the agent with tiers 1 and 2:

```bash
SC_TIER1_MODEL_DIR="$PWD/ml/models/tier1-onnx" SC_TIER2_MODEL=gemma4:e4b-it-q4_K_M \
  pnpm --filter @safecontext/agent dev
```

The agent logs `tier2_ready` once Ollama has the pinned model (same digest as
`ml/models.lock.json`) and has answered a first call. If not, it logs `tier2_unavailable` with a
reason (`unreachable`, `model_missing`, `digest_mismatch`) and keeps checking with tiers 0 and 1
only. The agent never downloads a model itself. Ollama unloads an idle model after 5 minutes, and
the next check pays for reloading it (about 6 s). To avoid that, start Ollama with
`OLLAMA_KEEP_ALIVE=-1`, at the cost of keeping 7 GB in use.

The prompts are read from `ml/prompts/tier2/`, the same files the evaluation in `ml/` scored. To
try it with the real model: `SC_TIER2_REAL=1 pnpm --filter @safecontext/agent test tier2.real`, and
`pnpm --filter @safecontext/agent exec tsx scripts/tier2-demo.ts` (before/after examples and
latency, with the variables above).

### 4. Dashboard and sync

```bash
pnpm --filter @safecontext/dashboard db:migrate              # create the tables
pnpm --filter @safecontext/dashboard db:seed                 # demo org "macrohard-demo", demo admin, policy v1, demo events
pnpm --filter @safecontext/dashboard enrollment-key          # prints a new key for macrohard-demo, once
pnpm --filter @safecontext/dashboard dev                     # dashboard on http://localhost:5173
```

Sign in as the seeded demo admin; the email and password are in
`apps/dashboard/prisma/demo-admin.ts` (local demo only). To add a real admin:
`pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name]` prints a new
password once.

Then start the agent pointed at the dashboard:

```bash
SC_DASHBOARD_URL=http://localhost:5173 SC_ENROLLMENT_KEY=<key> \
  SC_STATE_DIR=/tmp/sc-agent pnpm --filter @safecontext/agent dev
```

The agent logs `device_registered` and `policy_synced`. It stores its device token in the macOS
Keychain, so the key is only needed the first time. Checks you make in Claude Code should then
appear in the dashboard's live feed within a few seconds.

---

## Repo layout

| Path | What |
| --- | --- |
| `plugin/` | Claude Code plugin: `hooks/hooks.json`, `scripts/agent-status.sh` (start-up health check), `skills/status/` (`/safe-context:status`) |
| `apps/agent/` | Local agent (Hono on Node). `e2e/` holds the end-to-end tests that run real Claude Code |
| `apps/dashboard/` | Admin dashboard (SvelteKit 3, Prisma 7, Postgres 18) and the agent's API (`/api/*`) |
| `packages/policy/` | Shared data formats ("contracts"): policy, agent API, dashboard API, events, hook messages |
| `packages/detectors/` | Tier 0 rules and the term-list matcher |
| `ml/` | Python: dataset, evaluation harness, tier 1 fine-tuning and ONNX export, model hosting (`models.lock.json`). See [ml/README.md](ml/README.md) |
| `demo/` | Tools for the [MacroHard](https://github.com/SafeContext/MacroHard) demo: `start-agent.sh`, and the scenarios plus a check that runs them through the agent. See [demo/README.md](demo/README.md) |
| `.claude-plugin/marketplace.json` | Lists `plugin/` as a plugin marketplace, so a folder's settings can turn the plugin on (MacroHard uses it) |
| `installer/` | Homebrew formula and launchd (not built yet) |
| `docs/` | Findings: [hook shapes](docs/hook-shapes.md), [hook coverage](docs/hook-coverage.md) |

## Commands

```bash
pnpm check && pnpm lint                     # types and lint, every package
pnpm test                                   # unit tests, every package (the dashboard's also runs Playwright)
pnpm test:e2e                               # real Claude Code on haiku (small model cost) + dashboard Playwright
E2E_TIERS=1 pnpm --filter @safecontext/agent test:e2e   # the same with your SC_TIER1_*/SC_TIER2_* settings (tiers 1+2)
pnpm --filter @safecontext/<name> <script>  # one package
pnpm models:pull                            # pinned models and data from Hugging Face
cd ml && uv sync && uv run pytest           # ML tests (downloads the ML libraries on first run)
claude plugin validate ./plugin             # check the plugin
```

Playwright needs its test browser once per machine:
`pnpm --filter @safecontext/dashboard exec playwright install chromium`.

### Agent settings (environment variables)

| Variable | Default | What |
| --- | --- | --- |
| `SC_AGENT_PORT` | `4747` | Port on 127.0.0.1. The plugin's hooks always use 4747 |
| `SC_POLICY_FILE` | unset | Local policy file. Unset: the built-in default policy |
| `SC_CHECK_BUDGET_MS` | `8000` (max 25000) | Time allowed for one check. When it runs out, the policy's fail mode applies |
| `SC_TIER1_MODEL_DIR` | unset | Tier 1 model folder. Unset: tier 1 is off. Use an absolute path |
| `SC_TIER1_MODEL_FILE` | `model.onnx` | ONNX file in that folder |
| `SC_TIER1_THRESHOLD` | the model's `tier1.json`, else 0.5 | Lowest score that counts as a match |
| `SC_TIER1_THREADS` | `0` (all cores) | onnxruntime threads |
| `SC_TIER1_LABEL` | `{name}` | Label the model sees for a data type, when `labels.json` has none |
| `SC_TIER2_MODEL` | `gemma4:e4b-it-q4_K_M` once tier 2 is on | Tier 2 model name. Setting this or `SC_TIER2_BASE_URL` turns tier 2 on; unset both: off |
| `SC_TIER2_BASE_URL` | `http://127.0.0.1:11434/v1` (Ollama) | Any OpenAI-compatible server. Must be https, except on this Mac (localhost) |
| `SC_TIER2_API_KEY` | unset | Sent as `Authorization: Bearer`, for a company-hosted model server ([#75](https://github.com/SafeContext/safecontext/issues/75)). Never logged |
| `SC_TIER2_PROMPTS_DIR` | the repo's `ml/prompts/tier2` | Tier 2 prompt files |
| `SC_TIER2_TIMEOUT_MS` | `6000` (from `tier2.json`) | Longest one tier 2 call may take. Calls also stop in time for the check budget |
| `SC_DASHBOARD_URL` | unset | Dashboard address. Unset: no sync. Must be https, except localhost |
| `SC_ENROLLMENT_KEY` | unset | Organisation key, needed until the device has a token in the Keychain |
| `SC_STATE_DIR` | `~/Library/Application Support/SafeContext` | Device id and policy copy |
| `SC_POLICY_SYNC_INTERVAL_MS` | `30000` (min 5000) | How often to pull the policy |
| `SC_EVENT_FLUSH_MS` | `5000` | How often to upload counts |
| `SC_EVENT_BATCH_SIZE` | `100` (max 500) | Events per upload |
| `SC_EVENT_QUEUE_MAX` | `5000` | Events kept in memory while the dashboard can't be reached |
