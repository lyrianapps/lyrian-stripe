# lyrian-stripe Example App

A minimal Next.js todo app that demonstrates integrating the `lyrian-stripe` billing service, including:

- **Free tier** — 500 todos/month, hard cap enforced by the billing service
- **Pay-as-you-go** — unlimited todos at $0.04 each, billed via Stripe at month end
- **Flat-rate (Basic)** — unlimited todos at a fixed monthly price
- **Settings page** — shows current plan, live usage meter, and plan upgrade UI
- **Billing portal** — redirect to the Stripe-hosted portal to manage payment method / invoices

The app runs on port **3001** so it can co-exist with the billing service on port 3000.

---

## Quick start

### 1. Copy env vars

```bash
cp .env.example .env.local
```

Fill in:

- `BILLING_API_URL` — URL of your running lyrian-stripe instance (e.g. `http://localhost:3000`)
- `BILLING_API_KEY` — the API key for your app in the billing service
- `BILLING_APP_ID` — the app ID registered in the billing service
- `SAAS_JWT_SECRET` — must match `SAAS_JWT_SECRET` in the billing service `.env`
- `DATABASE_URL` — PostgreSQL connection string
- `PLAN_PAYGO_PRICE_ID` / `PLAN_BASIC_PRICE_ID` — Stripe Price IDs from your app's configured plans (leave blank to hide that plan)

### 2. Set up the database

```bash
# Create and migrate the example app's database
yarn db:migrate

# Or just push the schema without a migration file
yarn db:push
```

### 3. Run

```bash
# Start the billing service first (port 3000)
cd ../  && yarn dev

# In another terminal, start the example app (port 3001)
cd example-app && yarn dev
```

Visit http://localhost:3001 to see the todo app, and http://localhost:3001/settings for the billing settings page.

---

## How billing works in this app

Creating a todo is the **billable action**. The flow on `POST /api/todos`:

```
1. Call billing service: POST /api/usage/report
2a. allowed: true  → write todo to DB, return 201
2b. allowed: false → return 402 with upgradeRequired: true (free cap hit)
```

The UI shows an upgrade prompt inline when the 402 is returned. The user clicks "View plans" → Settings page → picks a PAYGO or Basic plan → Stripe Checkout → subscription created → from that point, every todo fires a Stripe Billing Meter event instead of hitting a cap.

---

## Architecture

```
Browser
  │
  ├── GET  /           → TodoApp component (todos + usage bar)
  └── GET  /settings   → SettingsPage component (plan cards + portal link)
         │
         ├── /api/todos           ──► billing service /api/usage/report
         ├── /api/billing/status  ──► billing service /api/subscription/status
         ├── /api/billing/usage   ──► billing service /api/usage/current
         ├── /api/billing/plans   ── reads from env vars (no billing call)
         ├── /api/billing/checkout ──► billing service /api/billing/checkout
         └── /api/billing/portal-redirect ──► signs JWT → billing service portal
```

The billing API key (`BILLING_API_KEY`) is **only ever used server-side** — it's never sent to the browser.
