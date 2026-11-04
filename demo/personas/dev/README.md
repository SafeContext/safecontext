# orders-api

Checkout, orders and invoices for Macrohard Flow.

```bash
npm install
cp .env.example .env   # ask in #orders-dev for staging values
npm run dev            # http://localhost:3000
```

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/checkout` | Charges a card and creates an order |
| `GET` | `/orders/:id` | One order |
| `POST` | `/invoices/:id/send` | Emails an invoice to the account's billing contact |

## Deploys

`scripts/notify-deploy.sh` posts to #deploys when a release goes out.
