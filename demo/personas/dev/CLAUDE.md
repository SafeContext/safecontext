# orders-api

Macrohard's checkout and billing service. TypeScript on Node 24, Postgres, Stripe for payments.

- Routes live in `src/routes/`, one file per resource.
- Payment code is in `src/billing/`. Never call Stripe from a route directly.
- Config comes from environment variables (see `.env`, not committed).
- Logs from staging are copied into `logs/` when we debug an incident.
- Tests: `npm test`. Lint: `npm run lint`.
