# Safe Context

Checks Claude Code prompts and cleans tool output with a company-run model, using a policy
IT controls from a dashboard. Read `SPEC.md` for the architecture, contracts, done-when tests
and open decisions. Scope: Claude Code only for pilot, then extend across all agentic apps, macOS (Apple Silicon) only for now.

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
- `ml/`: Python data generation, fine-tuning, evaluation, ONNX export. `ml/models.lock.json` pins
  the hosted models and data by commit and sha256; `artifacts push` updates it.
- `installer/`: Homebrew formula + launchd (not built yet).

Workspace packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`).
Use explicit `.ts` extensions in relative imports inside `packages/`.

## Dashboard (SvelteKit 3)

- Config lives in `vite.config.ts` via `sveltekit({ ... })`. There is **no `svelte.config.js`**.
- Import from `src/lib` with `#lib/...` (package.json subpath imports), as scaffolded.
- Runes mode is forced. Use Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`).
- Adapter: `@sveltejs/adapter-node`.
- The Svelte Claude Code plugin is enabled in `.claude/settings.json`. Use its MCP tools and
  skills for Svelte/SvelteKit questions.
- Tests: Vitest with `client` (browser, `*.svelte.spec.ts`) and `server` (node, `*.spec.ts`)
  projects. Playwright for e2e (`*.e2e.ts`).

### Styling

- **Tailwind 4 utility classes first.** Global CSS and Tailwind setup are in `src/routes/layout.css`.
- **SCSS only where Tailwind can't do the job**, in `<style lang="scss">` blocks (`sass-embedded`).
  Tailwind's docs discourage mixing it with Sass, so in SCSS:
  never use `@apply`, `@theme` or `@reference`; read design tokens as CSS variables
  (e.g. `var(--color-zinc-900)`).

### Environment variables (SvelteKit 3)

- Declare every variable in `src/env.ts` with `defineEnvVars` (from `@sveltejs/kit/env`).
- Read private (server-only) values from `$app/env/private`, public ones from `$app/env/public`.
  The old `$env/*` modules are deprecated. Don't use them.
- Other SvelteKit 3 renames: `$app/environment` → `$app/env`, `$app/stores` → `$app/state`.

### Database (Prisma 7.10.1 + Postgres 18)

- We are on **Prisma 7**, not Prisma 8 (still a release candidate). Use the **v7 docs**
  (https://www.prisma.io/docs/v7) and the Prisma skills in `.claude/skills/`. Ignore Prisma 8 patterns
  (`contract.prisma`, `contract emit`, `@prisma/orm-postgres`).
- Schema: `apps/dashboard/prisma/schema.prisma`. Config: `apps/dashboard/prisma7.config.ts`
  (Prisma 7.10 names it this way to avoid clashing with Prisma 8's format).
- Generated client: `src/lib/server/generated/prisma/` (gitignored). It regenerates on `pnpm install`
  (the dashboard's `prepare` script) and with `pnpm --filter @safecontext/dashboard db:generate`.
- Migrations: `pnpm --filter @safecontext/dashboard db:migrate` (`prisma migrate dev`). Commit
  `prisma/migrations/`.
- Client: `import { prisma } from '#lib/server/prisma.ts'` (uses `@prisma/adapter-pg`), **server-side
  only** (`+page.server.ts`, `+server.ts`, `hooks.server.ts`, `src/lib/server/`).
- `DATABASE_URL` is in `apps/dashboard/.env` (local DB: `safecontext` on native Postgres 18.6).
- Pin `prisma`, `@prisma/client` and `@prisma/adapter-pg` to the **same exact version**.
- Auth (not installed yet): Better Auth with its Prisma adapter. See SPEC.md §7.

## Agent (Hono)

- Endpoints, request and response bodies: SPEC.md §3. Validate every request and response with
  the schemas in `packages/policy`.
- Keep hook responses within Claude Code's timeouts (`UserPromptSubmit`: 30 s; aim far lower).
  The agent's own budget per check is `SC_CHECK_BUDGET_MS` (default 8 s); past it, the fail mode applies.
- Logs and dashboard events hold metadata only. Tests check that no prompt or tool text reaches them.

## ml/ (Python)

- `uv run ...` inside `ml/`. Add deps with `uv add`. The lock is limited to Apple Silicon macOS.
- Never commit weights, datasets or exports (`ml/models/`, `ml/data/raw/`, `*.onnx`, etc. are gitignored).
  They live in the private Hugging Face org `SafeContext` (#70); `pnpm models:pull` fetches them.
- Paid API spend for #14 is capped at $5 in total; run judge or data jobs through `claude -p`, and
  only after Joe OKs the run (see #14).

## CI and environment quirks

- CI (`.github/workflows/ci.yml`): `Node (check, lint, test)` with a `postgres:18.6` service. It runs
  `prisma migrate deploy`, then only the dashboard's `server` Vitest project (no Playwright in CI).
  `Python (ruff)` runs on macOS. `Plugin (validate)` uses Claude Code 2.1.302.
- In this sandbox, Bash commands that contain the word "eval" are refused. Use a glob such as
  `ev*` (e.g. `ml/src/safecontext_ml/ev*/`) instead of typing the name.
