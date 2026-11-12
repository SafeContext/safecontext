# dashboard

The Safe Context admin dashboard (SvelteKit 3, Prisma 7, Postgres 18), and the API the local
agent uses. Setup and the full "try it locally" steps are in the root [README](../../README.md);
coding rules are in [CLAUDE.md](../../CLAUDE.md).

## What's here

- **Sign-in** (`/sign-in`, #19): email + password with Better Auth (`src/lib/server/auth.ts`).
  Every other page needs a signed-in admin and shows only their organisation; `hooks.server.ts`
  redirects everyone else to sign-in. Nobody can sign up from the browser: admins come from
  `create-admin` (or the seed's demo admin, credentials in `prisma/demo-admin.ts`).
- **Overview** (`/`): checks in the last 7 days and a live feed (#24).
- **Policy** (`/policy`, #23): the policy editor. Edits save to the draft rows (`DataType`,
  `TermList`, `Organization.failMode` / `swapBackTools`) at once; Publish copies them into a new
  `PolicyVersion` (`src/lib/server/policy-draft.ts`). Board rules shared with the page are in
  `src/lib/policy-board.ts`. Only members with `role = admin` can change anything; `viewer`s
  see the page read-only.
- **Deploy** and **Settings**: placeholders (#25).
- **Agent API** (`src/routes/api/`, #21): `POST /api/devices`, `GET /api/policy`,
  `POST /api/events`. Authenticated by device tokens, not admin sign-in. Contracts in `packages/policy/src/dashboard-api.ts`; see SPEC.md §3.
- **Live feed stream** (`/live-feed`): server-sent events fed by Postgres `NOTIFY` on
  `safecontext_events`.

## Commands

Run from the repo root.

```bash
pnpm --filter @safecontext/dashboard dev              # http://localhost:5173
pnpm --filter @safecontext/dashboard db:migrate       # prisma migrate dev
pnpm --filter @safecontext/dashboard db:seed          # demo org and admin, policy v1, demo events
pnpm --filter @safecontext/dashboard enrollment-key [org-slug]   # new enrollment key (default macrohard-demo)
pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name] [--viewer|--admin]   # add an admin / new password
pnpm --filter @safecontext/dashboard check
pnpm --filter @safecontext/dashboard lint
pnpm --filter @safecontext/dashboard test             # Vitest (client + server) then Playwright
```

The `server` Vitest project needs a database (`DATABASE_URL` in `.env`) and `BETTER_AUTH_SECRET`.
Playwright signs in as the seeded demo admin first (`src/routes/auth.setup.ts`), so run `db:seed`. Playwright needs its
browser once per machine: `pnpm --filter @safecontext/dashboard exec playwright install chromium`.
