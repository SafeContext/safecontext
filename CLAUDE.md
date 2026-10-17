# Safe Context

Checks Claude Code prompts and cleans tool output with a company-run model, using a policy
IT controls from a dashboard. Read `SPEC.md` for the architecture, contracts, done-when tests
and open decisions. Scope: Claude Code only for pilot, then extend across all agentic apps, macOS (Apple Silicon) only for now.

## Work tracking

- All work is in GitHub issues. **Start at the pinned roadmap: issue #1.**
- Pick one issue. Check its "Depends on" list is done first.
- Branch `issue-<n>-short-name`; open a PR with `Closes #<n>`. `main` is protected (PR + 1 approval).
- Keep PRs to one issue. If you find new work, open a new issue instead of growing the PR.

## Ground rules

- **Ask before guessing.** If a spec detail, API shape or product decision is unclear, ask.
  Items in SPEC.md §7 "Open decisions" are not yours to decide.
- **Check current docs** before using a library API. Several tools here are newer than most
  training data (SvelteKit 3, Vite 8, pnpm 12, Zod 4, Tailwind 4, Prisma 7.10).

## Tooling

- Node **24** (`.nvmrc`; use `nvm use`). pnpm **12** workspace (`pnpm-workspace.yaml`).
- TypeScript **6.0.3** everywhere. Don't upgrade to TS 7 until svelte-check supports it.
- Python **3.14** via **uv**, only in `ml/`.
- Root commands: `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm test`
  (each runs in every workspace package that defines it).
- Target one package: `pnpm --filter @safecontext/<name> <script>`.
- pnpm 12 blocks dependency install scripts and agent-skill installs by default. Approvals live
  in `pnpm-workspace.yaml` (`allowBuilds`, `permissions`). **Don't approve new ones without asking.**
- Agent skills: `.claude/skills/` (Prisma skills, tracked in `skills-lock.json`, managed with
  `npx skills`). The Svelte plugin is enabled in `.claude/settings.json`.

## Layout

- `apps/agent`: local agent (Hono on Node). Implements the Agent API in SPEC.md §3.
- `apps/dashboard`: admin dashboard (SvelteKit 3).
- `packages/policy`: Zod schemas and hook I/O types. **Single source of truth** for contracts.
- `packages/detectors`: tier 0 rules and term lists.
- `plugin/`: Claude Code plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`).
  Validate with `claude plugin validate ./plugin`; try it with `claude --plugin-dir ./plugin`.
- `ml/`: Python data generation, fine-tuning, evaluation, ONNX export.
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

## ml/ (Python)

- `uv run ...` inside `ml/`. Add deps with `uv add`. The lock is limited to Apple Silicon macOS.
- Never commit weights, datasets or exports (`ml/models/`, `ml/data/raw/`, `*.onnx`, etc. are gitignored).
