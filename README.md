# Lyrian Stripe - Centralized Billing Service

A centralized billing service that handles Stripe subscriptions for multiple SaaS applications.

> ⚠️ **Disclaimer: Not Production Ready**
>
> This software is currently in active development and is **not ready for production use**.

## Overview

This billing app allows you to:

- Manage subscriptions for multiple SaaS products from one place
- Handle Stripe webhooks centrally
- Provide a unified billing portal UI for end users
- Let SaaS backends check subscription status via API
- **Each SaaS app configures its own pricing plans** - no hardcoded global prices
- **Each SaaS app owns its own email sending** - per-app Resend API key and sending domain
- **Each SaaS app owns its own Stripe account** - per-app Stripe keys stored in the database, not in infrastructure secrets

## Architecture

```
┌─────────────────┐      ┌─────────────────────────────────┐      ┌─────────────────┐
│    SaaS A       │      │      Lyrian Billing App         │      │     Stripe      │
│   (your app)    │      │    (this repository)            │      │                 │
└────────┬────────┘      └───────────────┬─────────────────┘      └────────┬────────┘
         │                               │                                  │
         │ ───── API Key (backend) ────► │                                  │
         │                               │                                  │
         │ ───── JWT Token (portal) ───► │                                  │
         │                               │ ◄─────── Webhooks ───────────────│
         │                               │                                  │
```

## Authentication

This app supports **two authentication methods** for protected routes:

### 1. API Key (Server-to-Server)

Used when your SaaS backend needs to call the billing API directly.

```bash
curl -X GET "https://billing.yourdomain.com/api/subscription/status?appId=saas-a&externalUserId=user-123" \
  -H "x-api-key: sk_live_abc123..."
```

**When to use:** Checking subscription status, server-side access control

### 2. Session Cookie (Browser Users)

Used automatically when users navigate to the billing portal through your app.

**When to use:** User clicks "Manage Subscription" → redirected to billing portal → cookie is set automatically

### Authentication Flow Diagram

```
┌─────────────────┐      ┌─────────────────────────────────┐      ┌─────────────────┐
│    SaaS A       │      │         Billing App             │      │  User Browser   │
└────────┬────────┘      └───────────────┬─────────────────┘      └────────┬────────┘
         │                               │                                  │
         │  1. User clicks               │                                  │
         │     "Manage Subscription"     │                                  │
         │                               │                                  │
         │  2. Generate JWT              │                                  │
         │     (iss=saas-a, sub=user-123)│                                  │
         │                               │                                  │
         │  3. Redirect ────────────────►│                                  │
         │     /api/billing/portal?token=│                                  │
         │                               │                                  │
         │                               │  4. Verify JWT                   │
         │                               │  5. Create billing_session       │
         │                               │  6. Set cookie ─────────────────►│
         │                               │                                  │
         │                               │  7. Redirect to /subscription    │
         │                               │     (user sees plans UI)         │
         │                               │                                  │
         │                               │◄──── 8. User upgrades (cookie) ──│
         │                               │                                  │
         │  9. Poll subscription status  │                                  │
         │     (with API key)            │                                  │
         │◄──────────────────────────────│                                  │
```

## Integration Guide

### Step 1: Register Your SaaS App with Pricing Plans

Create a plans JSON file in the repo root containing your Stripe product/price IDs. **Stripe keys and email credentials are never stored in the file** — they are injected at runtime via the CI workflow or CLI flags.

```json
// my-app-plans.json
[
  {
    "planKey": "free_trial",
    "name": "Free Trial",
    "description": "Try it free for 14 days",
    "price": 0,
    "stripeProductId": "prod_YOUR_FREE_PRODUCT_ID",
    "stripePriceId": "price_YOUR_FREE_PRICE_ID"
  },
  {
    "planKey": "basic",
    "name": "Basic",
    "description": "For individuals and small teams",
    "price": 1000,
    "stripeProductId": "prod_YOUR_BASIC_PRODUCT_ID",
    "stripePriceId": "price_YOUR_BASIC_PRICE_ID"
  },
  {
    "planKey": "pro",
    "name": "Pro",
    "description": "For businesses and power users",
    "price": 3000,
    "stripeProductId": "prod_YOUR_PRO_PRODUCT_ID",
    "stripePriceId": "price_YOUR_PRO_PRICE_ID"
  }
]
```

See `scripts/example-plans.json` for a ready-to-copy template.

Then trigger the **`register-app.yml`** GitHub Actions workflow, providing:

- `plans_file` — the filename above (e.g. `my-app-plans.json`)
- `stripe_secret_key` — your app's Stripe `sk_live_...` or `sk_test_...` key (masked in logs, never committed)
- `stripe_publishable_key` — your app's Stripe `pk_live_...` or `pk_test_...` key
- `stripe_webhook_secret` — your app's Stripe `whsec_...` webhook signing secret
- `resend_api_key` — your Resend `re_live_...` key (masked in logs, never committed)
- `from_email` — e.g. `billing@yourapp.com`

The workflow registers the app, injects all credentials into the DB at runtime, then **automatically deletes the plans file from the repo** via a follow-up commit — so no Stripe IDs linger in git history after registration.

To register locally instead:

```bash
npx tsx scripts/create-app.ts <app-id> "<app-name>" <plans.json>

# Example:
npx tsx scripts/create-app.ts saas-a "My Todo App" ./my-app-plans.json
```

**Re-running the script on an existing app** will update only the email credentials. The API key and plans are left untouched.

To add or update plans for an existing app:

```bash
npx tsx scripts/add-plans.ts <app-id> <plans.json>
```

Save the API key securely — it won't be shown again.

### Step 2: Set Up Environment Variables in Your SaaS App

```env
# .env.local
BILLING_APP_URL=https://billing.yourdomain.com
BILLING_API_KEY=sk_live_abc123...           # For backend API calls
SAAS_JWT_SECRET=your-shared-secret          # Same secret as billing app
```

### Step 3: Create Billing Utilities in Your SaaS App

```typescript
// lib/billing.ts
import jwt from "jsonwebtoken";

const BILLING_APP_URL = process.env.BILLING_APP_URL!;
const BILLING_API_KEY = process.env.BILLING_API_KEY!;
const JWT_SECRET = process.env.SAAS_JWT_SECRET!;

/**
 * Generate a signed JWT for the billing portal
 */
export function createBillingToken(userId: string): string {
  return jwt.sign(
    {
      iss: "saas-a",        // Your registered app ID
      sub: userId,          // User's ID in your SaaS
    },
    JWT_SECRET,
    { expiresIn: "5m" }
  );
}

/**
 * Get the URL to redirect users to the billing portal
 */
export function getBillingPortalUrl(userId: string): string {
  const token = createBillingToken(userId);
  return `${BILLING_APP_URL}/api/billing/portal?token=${token}`;
}

/**
 * Check subscription status (server-side)
 */
export async function getSubscriptionStatus(userId: string) {
  const res = await fetch(
    `${BILLING_APP_URL}/api/subscription/status?appId=saas-a&externalUserId=${userId}`,
    {
      headers: { "x-api-key": BILLING_API_KEY },
    }
  );
  return res.json();
}
```

### Step 4: Add "Manage Subscription" Button

```tsx
// app/settings/billing/page.tsx
import { redirect } from "next/navigation";
import { getBillingPortalUrl } from "@/lib/billing";
import { getCurrentUser } from "@/lib/auth";

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const billingUrl = getBillingPortalUrl(user.id);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Subscription</h1>
      <a
        href={billingUrl}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Manage Subscription →
      </a>
    </div>
  );
}
```

### Step 5: Check Subscription Status (Access Control)

```typescript
// middleware.ts or server action
import { getSubscriptionStatus } from "@/lib/billing";

export async function checkPremiumAccess(userId: string) {
  const { plan, status } = await getSubscriptionStatus(userId);

  if (plan === "free_trial" && status === "expired") {
    return { allowed: false, reason: "Trial expired" };
  }

  if (plan === "basic" || plan === "pro") {
    return { allowed: true };
  }

  return { allowed: false, reason: "Upgrade required" };
}
```

## API Reference

### Protected Routes (require auth)

| Endpoint                   | Method | Auth               | Description                    |
| -------------------------- | ------ | ------------------ | ------------------------------ |
| `/api/subscription/status` | GET    | API Key or Session | Get user's subscription status |
| `/api/billing/checkout`    | POST   | API Key or Session | Create Stripe checkout session |

### Public Routes

| Endpoint                  | Method | Description                                   |
| ------------------------- | ------ | --------------------------------------------- |
| `/api/billing/portal`     | GET    | Entry point for billing portal (JWT in query) |
| `/api/billing/webhook`    | POST   | Stripe webhook handler                        |
| `/api/apps/[appId]/plans` | GET    | Get pricing plans for a specific app          |

## Environment Variables

| Variable                | Required | Description                                                                 |
| ----------------------- | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`          | ✅       | PostgreSQL connection string                                                |
| `SAAS_JWT_SECRET`       | ✅       | Shared secret for JWT signing/verification                                  |
| `CRON_SECRET`           | ✅       | Secret for authenticating cron job requests                                 |
| `STRIPE_SECRET_KEY`     | Optional | Global fallback Stripe secret key (used when an app has no per-app key set) |
| `STRIPE_WEBHOOK_SECRET` | Optional | Global fallback Stripe webhook secret                                       |
| `STRIPE_PK_KEY`         | Optional | Global fallback Stripe publishable key                                      |
| `RESEND_API_KEY`        | Optional | Global fallback Resend key (used when an app has no per-app key set)        |

> **Note:** Stripe keys and price/product IDs are no longer required infrastructure secrets. Each SaaS app registers its own Stripe credentials and pricing plans via `create-app.ts` or the `register-app.yml` CI workflow. The global env vars serve only as a fallback when no per-app key is stored.
>
> **Note:** Each registered app can store its own `resendApiKey` and `fromEmail` in the database. These take precedence over the global `RESEND_API_KEY` fallback.

## Stripe Credentials

Stripe key ownership is **per SaaS app** — each registered app stores its own Stripe secret key, publishable key, and webhook signing secret in the database. This means each SaaS product points to its own Stripe account, and the billing portal never needs global Stripe credentials in its infrastructure secrets.

### How it works

1. When a Stripe API call is made (checkout, cancellation, webhook verification), the app's own `stripeSecretKey` / `stripeWebhookSecret` is fetched from the database.
2. If the app has no per-app key stored, it falls back to the global `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` environment variables.
3. If neither is available, the request fails with a clear error.

### Webhook endpoint

Each app gets a dedicated webhook endpoint:

```
POST /api/billing/webhook/{appId}
```

Register this URL in your Stripe dashboard (under **Developers → Webhooks**) with your app's `whsec_...` signing secret.

### Registering Stripe credentials for an app

Stripe credentials are always injected at runtime — they are never stored in the plans JSON file or committed to the repo.

**Via CI (recommended):** trigger `register-app.yml` and fill in `stripe_secret_key`, `stripe_publishable_key`, and `stripe_webhook_secret` as workflow inputs. They are masked in logs and written directly to the database.

**Locally:**

```bash
APP_STRIPE_SECRET_KEY=sk_live_... \
APP_STRIPE_PK_KEY=pk_live_... \
APP_STRIPE_WEBHOOK_SECRET=whsec_... \
npx tsx scripts/create-app.ts saas-a "My Todo App" ./plans.json
```

Re-running either method on an existing app only patches the credentials; the API key and plans are preserved.

## Email Notifications

This app sends transactional emails via [Resend](https://resend.com). Email ownership is **per SaaS app** — each registered app can use its own Resend API key and sending domain so that emails appear to come from the SaaS product, not from the billing portal.

### How it works

1. When a Stripe webhook fires (e.g. `checkout.session.completed`), the webhook handler looks up the app in the database.
2. If the app has a `resendApiKey` and `fromEmail` stored, those are used for the email send.
3. If not, the handler falls back to the global `RESEND_API_KEY` environment variable.
4. If neither is available, the email send is skipped gracefully.

### Registering email credentials for an app

Email credentials are always injected at runtime — they are never stored in the plans JSON file.

**Via CI (recommended):** trigger `register-app.yml` and fill in `resend_api_key` and `from_email` as workflow inputs. They are masked in logs and written directly to the database.

**Locally:**

```bash
APP_RESEND_API_KEY=re_live_... \
APP_FROM_EMAIL=billing@yourapp.com \
npx tsx scripts/create-app.ts saas-a "My Todo App" ./plans.json
```

Re-running either method on an existing app only patches the email credentials; the API key and plans are preserved.

### From address

The `fromEmail` must be an address on a domain you have verified in Resend (DNS records added to the domain). It is independent of your GCP routing — Resend delivers the email directly via its own infrastructure.

## Development

```bash
# Install dependencies
yarn install

# Set up database
npx prisma migrate dev

# Seed database
npx prisma db seed

# Run development server
yarn run dev
```

## Scripts

### Create Test Subscription

Create a test subscription for local development:

```bash
npm run create-test-subscription -- <appId> <externalUserId> [minutes]

# Example: 30-minute test subscription
npm run create-test-subscription -- myApp user123 30
```

### Cron: Downgrade Expired Subscriptions

Downgrade expired subscriptions to `free_trial`. Uses Stripe as source of truth.

```bash
# Expired only (default) - checks subscriptions past currentPeriodEnd
curl -X POST http://localhost:3000/api/cron/downgrade-expired \
  -H "x-cron-secret: YOUR_CRON_SECRET"

# Full sync - checks ALL active subscriptions against Stripe
# Use to catch deleted/canceled subscriptions
curl -X POST "http://localhost:3000/api/cron/downgrade-expired?mode=full" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

**GCP Cloud Scheduler:**

```bash
gcloud scheduler jobs create http downgrade-expired \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="https://your-app.com/api/cron/downgrade-expired" \
  --http-method=POST \
  --headers="x-cron-secret=YOUR_CRON_SECRET"
```

## Deployment

This app is designed to run on Google Cloud Run with Cloud Scheduler for cron jobs.

See deployment documentation for details.
