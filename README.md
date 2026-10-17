# Safe Context

Use AI. Keep the secrets. Safe Context checks Claude Code prompts and cleans tool output with a
company-run model, following a policy IT controls from a dashboard.

- **Architecture, contracts, open decisions:** [SPEC.md](SPEC.md)
- **Rules for coding agents:** [CLAUDE.md](CLAUDE.md)

## Setup (macOS, Apple Silicon)

Requires Node 24 (nvm), pnpm 12, uv, PostgreSQL 18.

```bash
nvm use
pnpm install
createdb safecontext                          # local database
cp apps/dashboard/.env.example apps/dashboard/.env   # then set DATABASE_URL
pnpm --filter @safecontext/dashboard db:generate
```

## Run

```bash
pnpm --filter @safecontext/agent dev       # agent on http://127.0.0.1:4747
pnpm --filter @safecontext/dashboard dev   # dashboard
claude --plugin-dir ./plugin               # Claude Code with the Safe Context hooks
```

## Check

```bash
pnpm check && pnpm lint
pnpm --filter @safecontext/detectors test
cd ml && uv sync && uv run pytest          # downloads the ML libraries on first run
```
