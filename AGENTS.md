# Safe Context

Checks Claude Code prompts and cleans tool output with a company-run model, using a policy
IT controls from a dashboard. Read `SPEC.md` for the architecture, contracts, done-when tests
and open decisions. Scope: Claude Code only for pilot, then extend across all agentic apps, macOS (Apple Silicon) only for now.

These instructions are for every coding agent. `AGENTS.md` is the one source of truth; each
`CLAUDE.md` only imports the `AGENTS.md` next to it, so Claude Code and Codex read the same rules.
App-specific rules live in the app's own folder and load when you work there.

## Work tracking

- All work is in GitHub issues. **Start at the pinned roadmap: issue #1.**
- Pick one issue. Check its "Depends on" list is done first.
- Branch `issue-<n>-short-name`; open a PR with `Closes #<n>`. `main` is protected by the
  "Protect main" ruleset:
  - **Squash merges only.** One PR = one commit on `main`.
  - **Every review thread must be resolved** before merging. New pushes dismiss earlier approvals.
  - **Head branches auto-delete on merge.** That closes any PR stacked on the deleted branch
    (e.g. #65 when #64 merged). Retarget stacked PRs to `main` before merging the one below.
- Keep PRs to one issue. If you find new work, open a new issue instead of growing the PR.
- **PR descriptions must follow `.github/pull_request_template.md`.** Fill every section; write
  "None" rather than deleting one. Write the Summary for someone who doesn't code, and explain any
  technical term. Put anything a human must decide or do under "Needs human input".
  With `gh pr create`, pass the filled-in template via `--body-file`.

## Ground rules

- **Ask before guessing.** If a spec detail, API shape or product decision is unclear, ask.
  Items in SPEC.md §7 "Open decisions" are not yours to decide.
- **Check current docs** before using a library API. Several tools here are newer than most
  training data (SvelteKit 3, Vite 8, pnpm 12, Zod 4, Tailwind 4, Prisma 7.10).

## Tooling

- Node **24** (`.nvmrc`; use `nvm use`). pnpm **12** workspace (`pnpm-workspace.yaml`).
- TypeScript **6.0.3** everywhere. Don't upgrade to TS 7 until svelte-check supports it.
- Python **3.14** via **uv**, only in `ml/`.
- Root commands: `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`
  (each runs in every workspace package that defines it). The dashboard's `test` also runs
  Playwright. `test:e2e` runs real Claude Code on haiku (`apps/agent/e2e/`), costs a little model
  usage, and isn't in `pnpm test` or CI.
- `pnpm models:pull`: downloads the models and data pinned in `ml/models.lock.json` from the
  private Hugging Face org `SafeContext` (needs your own read token; see `ml/README.md`).
- Target one package: `pnpm --filter @safecontext/<name> <script>`.
- pnpm 12 blocks dependency install scripts and agent-skill installs by default. Approvals live
  in `pnpm-workspace.yaml` (`allowBuilds`, `permissions`). **Don't approve new ones without asking.**
- Agent skills: `.claude/skills/` (Prisma skills, tracked in `skills-lock.json`, managed with
  `npx skills`). The Svelte plugin is enabled in `.claude/settings.json`.

## Layout

- `apps/agent`: local agent (Hono on Node). Implements the Agent API in SPEC.md §3. Settings are
  `SC_*` environment variables (`src/config.ts`, `src/sync/config.ts`). `e2e/`: plugin and
  end-to-end tests against the real agent (the status-script test runs in `pnpm test`).
- `apps/dashboard`: admin dashboard (SvelteKit 3) and the agent's API (`src/routes/api/`).
- `packages/policy`: Zod schemas and hook I/O types. **Single source of truth** for contracts.
- `packages/detectors`: tier 0 rules and term lists.
- `plugin/`: Claude Code plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `scripts/agent-status.sh` for the SessionStart check, `skills/status/` for `/safe-context:status`).
  Validate with `claude plugin validate ./plugin`; try it with `claude --plugin-dir ./plugin`.
  The hook URLs are fixed at port 4747 (Claude Code doesn't expand variables there).
- `demo/`: tools for the demo personas, which live in their own repo, `SafeContext/MacroHard`.
  `demo/scenarios.ts` lists what each should do; `node demo/check.ts` checks them against a running
  agent, and `--list` makes MacroHard's TRY-THESE.md. Keep expectations in step when tiers change.
- `ml/`: Python data generation, fine-tuning, evaluation, ONNX export. `ml/models.lock.json` pins
  the hosted models and data by commit and sha256; `artifacts push` updates it.
- `installer/`: Homebrew formula + launchd (not built yet).

Workspace packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`).
Use explicit `.ts` extensions in relative imports inside `packages/`.

## Per-app rules

Read the app's `AGENTS.md` before changing it. The rules most often missed:

- `apps/dashboard/AGENTS.md`: SvelteKit 3 (no `svelte.config.js`; `$app/env`, not `$env/*`),
  Tailwind 4, and **Prisma 7, not 8**.
- `apps/agent/AGENTS.md`: validate every request and response with `packages/policy`; logs and
  dashboard events hold metadata only.
- `ml/AGENTS.md`: Python through `uv` only; never commit weights or datasets; paid API spend for
  #14 needs Joe's OK.

## CI and environment quirks

- CI (`.github/workflows/ci.yml`): `Node (check, lint, test)` with a `postgres:18.6` service. It runs
  `prisma migrate deploy`, then only the dashboard's `server` Vitest project (no Playwright in CI).
  `Python (ruff)` runs on macOS. `Plugin (validate)` uses Claude Code 2.1.302.
- In this sandbox, Bash commands that contain the word "eval" are refused. Use a glob such as
  `ev*` (e.g. `ml/src/safecontext_ml/ev*/`) instead of typing the name.
