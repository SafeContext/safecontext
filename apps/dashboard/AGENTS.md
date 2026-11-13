# Dashboard (SvelteKit 3)

Rules for `apps/dashboard`. The repo-wide rules are in the root `AGENTS.md`.

- Config lives in `vite.config.ts` via `sveltekit({ ... })`. There is **no `svelte.config.js`**.
- Import from `src/lib` with `#lib/...` (package.json subpath imports), as scaffolded.
- Runes mode is forced. Use Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`).
- Adapter: `@sveltejs/adapter-node`.
- The Svelte Claude Code plugin is enabled in `.claude/settings.json`. Use its MCP tools and
  skills for Svelte/SvelteKit questions.
- Tests: Vitest with `client` (browser, `*.svelte.spec.ts`) and `server` (node, `*.spec.ts`)
  projects. Playwright for e2e (`*.e2e.ts`).

## Styling

- **Tailwind 4 utility classes first.** Global CSS and Tailwind setup are in `src/routes/layout.css`.
- **SCSS only where Tailwind can't do the job**, in `<style lang="scss">` blocks (`sass-embedded`).
  Tailwind's docs discourage mixing it with Sass, so in SCSS:
  never use `@apply`, `@theme` or `@reference`; read design tokens as CSS variables
  (e.g. `var(--color-zinc-900)`).

## Design ("calm and clear", #96)

- The brand mark is in `brand/`. Its three colours always mean results: mint = nothing found,
  lemon = hidden / make it vague, pink = blocked / never share. Map results with `#lib/tones.ts`.
- Colours are tokens in `src/routes/layout.css`; never type a hex value in a component.
- Components: `ui/` (generic), `layout/` (app frame), one folder per page (`overview/`, `policy/`).
- Wording: plain English for IT admins, short sentences, product-neutral ("device", not "Mac").
- Colour never carries meaning alone (pair it with a label); text contrast 4.5:1; anything
  draggable also works from a menu or the keyboard.

## Environment variables (SvelteKit 3)

- Declare every variable in `src/env.ts` with `defineEnvVars` (from `@sveltejs/kit/env`).
- Read private (server-only) values from `$app/env/private`, public ones from `$app/env/public`.
  The old `$env/*` modules are deprecated. Don't use them.
- Other SvelteKit 3 renames: `$app/environment` → `$app/env`, `$app/stores` → `$app/state`.

## Database (Prisma 7.10.1 + Postgres 18)

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
- Auth: Better Auth with its Prisma adapter, email + password (`src/lib/server/auth.ts`, #19).
  `hooks.server.ts` guards every page; read the organisation with `currentOrganization()`
  (`src/lib/server/current-org.ts`), never from a request parameter. The agent API (`/api/devices`,
  `/api/policy`, `/api/events`) uses device tokens instead. Needs `BETTER_AUTH_SECRET` in `.env`.
