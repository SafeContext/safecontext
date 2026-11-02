# dashboard

The Safe Context admin dashboard (SvelteKit 3, Prisma 7, Postgres 18), and the API the local
agent uses. Setup and the full "try it locally" steps are in the root [README](../../README.md);
coding rules are in [CLAUDE.md](../../CLAUDE.md).

## What's here

- **Overview** (`/`): checks in the last 7 days and a live feed (#24). Shows the seeded
  `macrohard-demo` organisation until sign-in exists (#19).
- **Policy**, **Deploy** and **Settings**: placeholders (#23, #25, #19).
- **Agent API** (`src/routes/api/`, #21): `POST /api/devices`, `GET /api/policy`,
  `POST /api/events`. Contracts in `packages/policy/src/dashboard-api.ts`; see SPEC.md §3.
- **Live feed stream** (`/live-feed`): server-sent events fed by Postgres `NOTIFY` on
  `safecontext_events`.

## Commands

Run from the repo root.

```bash
pnpm --filter @safecontext/dashboard dev              # http://localhost:5173
pnpm --filter @safecontext/dashboard db:migrate       # prisma migrate dev
pnpm --filter @safecontext/dashboard db:seed          # demo org, policy v1, demo events
pnpm --filter @safecontext/dashboard enrollment-key [org-slug]   # new enrollment key (default macrohard-demo)
pnpm --filter @safecontext/dashboard check
pnpm --filter @safecontext/dashboard lint
pnpm --filter @safecontext/dashboard test             # Vitest (client + server) then Playwright
```

The `server` Vitest project needs a database (`DATABASE_URL` in `.env`). Playwright needs its
browser once per machine: `pnpm --filter @safecontext/dashboard exec playwright install chromium`.
