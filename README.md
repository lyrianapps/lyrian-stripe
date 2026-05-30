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
    "planKey": "free_trial", // owned by our app not stripe
    "name": "Free Trial",
    "description": "Try it free for 14 days",
    "price": 0,
    "stripeProductId": "prod_YOUR_FREE_PRODUCT_ID",
    "stripePriceId": "price_YOUR_FREE_PRICE_ID"
  },
  {
    "planKey": "basic", // owned by our app not stripe
    "name": "Basic",
    "description": "For individuals and small teams",
    "price": 1000,
    "stripeProductId": "prod_YOUR_BASIC_PRODUCT_ID",
    "stripePriceId": "price_YOUR_BASIC_PRICE_ID"
  },
  {
    "planKey": "pro", // owned by our app not stripe
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

---

## Pay-as-you-go Billing

The billing service supports three billing models that can be mixed across plans for the same app:

| Model             | `billingType`                     | How it works                                                                               |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| **Flat-rate**     | `flat_rate`                       | Fixed monthly charge. Usage is tracked but never blocked or billed per-unit.               |
| **Free tier**     | `flat_rate` + `freeUnitsPerMonth` | No charge, but usage is hard-capped. Returns `allowed: false` at the limit.                |
| **Pay-as-you-go** | `metered`                         | No monthly fee. Every unit fires a Stripe Billing Meter event and is billed at period end. |
| **Volume**        | `volume`                          | Like metered but typically with a committed minimum and a lower per-unit rate.             |

### Architecture

```
┌──────────────────────┐        ┌──────────────────────────────────────────┐
│   Your SaaS App      │        │           Lyrian Billing Service         │
│                      │        │                                          │
│  user does action    │        │  POST /api/usage/report                  │
│  (e.g. verification) │──────► │                                          │
│                      │        │  1. Resolve customer's plan              │
│  if !allowed:        │        │  2. Check freeUnitsPerMonth cap (free)   │
│    show upgrade UI   │◄───────│  3. Increment MonthlyUsage counter       │
│  else:               │        │  4. Fire Stripe meter event (paygo)      │
│    proceed           │        │                                          │
└──────────────────────┘        └────────────────────┬─────────────────────┘
                                                     │
                                                     │ meterEvents.create()
                                                     ▼
                                          ┌──────────────────┐
                                          │      Stripe      │
                                          │                  │
                                          │  Aggregates      │
                                          │  usage events    │
                                          │  → bills at      │
                                          │  period end      │
                                          └──────────────────┘
```

### Stripe Setup (one-time per app)

**1. Create a Billing Meter in Stripe**

In your Stripe dashboard → **Billing → Meters → Create meter**, or via API:

```bash
stripe billing meters create \
  --event-name verifications \
  --display-name "Verifications" \
  --default-aggregation[formula] sum
```

Save the `event_name` (e.g. `verifications`) — this goes in `AppPlan.stripeMeterEventName`.

**2. Create a metered Price linked to that meter**

In Stripe dashboard → **Products → Create product**, then add a recurring metered price:

```
Billing model: Usage-based
Meter: verifications
Unit amount: $0.04
```

Save the `price_xxx` ID — this is your `stripePriceId` for the paygo plan.

**3. Register the plan in the billing service**

```json
// paygo-plan.json
[
  {
    "planKey": "paygo",
    "name": "Pay as you go",
    "description": "Only pay for what you use — $0.04 per verification",
    "price": 0,
    "billingType": "metered",
    "unitAmount": 4,
    "freeUnitsPerMonth": null,
    "stripeMeterEventName": "verifications",
    "stripeProductId": "prod_YOUR_PAYGO_PRODUCT_ID",
    "stripePriceId": "price_YOUR_PAYGO_PRICE_ID",
    "sortOrder": 1
  },
  {
    "planKey": "free_trial",
    "name": "Free",
    "description": "500 verifications/month, 1 project",
    "price": 0,
    "billingType": "flat_rate",
    "freeUnitsPerMonth": 500,
    "stripeProductId": "prod_YOUR_FREE_PRODUCT_ID",
    "stripePriceId": "price_YOUR_FREE_PRICE_ID",
    "sortOrder": 0
  },
  {
    "planKey": "volume",
    "name": "Volume",
    "description": "10,000 verifications/month minimum — $0.02/verification",
    "price": 0,
    "billingType": "volume",
    "unitAmount": 2,
    "minMonthlyUnits": 10000,
    "freeUnitsPerMonth": null,
    "stripeMeterEventName": "verifications",
    "stripeProductId": "prod_YOUR_VOLUME_PRODUCT_ID",
    "stripePriceId": "price_YOUR_VOLUME_PRICE_ID",
    "sortOrder": 2
  }
]
```

```bash
npx tsx scripts/add-plans.ts <app-id> ./paygo-plan.json
```

### Integration: Reporting Usage from Your SaaS App

Your SaaS app calls the usage endpoint every time a billable action occurs. The billing service handles enforcement and Stripe reporting automatically.

```typescript
// In your SaaS app — call this on every billable action
async function reportVerification(userId: string): Promise<{ allowed: boolean }> {
  const res = await fetch(`${BILLING_APP_URL}/api/usage/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": BILLING_API_KEY,
    },
    body: JSON.stringify({
      appId: "your-app-id",
      externalUserId: userId,
      quantity: 1,        // number of units consumed
    }),
  });

  const data = await res.json();
  // data: { allowed, used, cap, remaining, plan, billingType, yearMonth }
  return data;
}

// Usage in your route handler
const usage = await reportVerification(user.id);

if (!usage.allowed) {
  return Response.json({
    error: "Monthly verification limit reached",
    used: usage.used,
    cap: usage.cap,
    upgradeUrl: getBillingPortalUrl(user.id),
  }, { status: 402 });
}

// proceed with the verification...
```

**What happens inside the service per plan type:**

| Customer plan | `freeUnitsPerMonth` set? | Stripe meter event fired?     | Blocked at cap? |
| ------------- | ------------------------ | ----------------------------- | --------------- |
| `free_trial`  | Yes (e.g. 500)           | No                            | Yes             |
| `paygo`       | No                       | Yes (`billingType: metered`)  | No              |
| `volume`      | No                       | Yes (`billingType: volume`)   | No              |
| `basic`/`pro` | No                       | No (`billingType: flat_rate`) | No              |

### Querying Current Usage (for dashboard display)

```typescript
// GET /api/usage/current?appId=xxx&externalUserId=xxx
// Returns: { allowed, used, cap, remaining, plan, billingType, yearMonth }

const usage = await fetch(
  `${BILLING_APP_URL}/api/usage/current?appId=your-app-id&externalUserId=${userId}`,
  { headers: { "x-api-key": BILLING_API_KEY } }
).then(r => r.json());

// Example response for a free-tier user at 312/500:
// { allowed: true, used: 312, cap: 500, remaining: 188, plan: "free_trial", ... }

// Example response for a paygo user:
// { allowed: true, used: 4821, cap: null, remaining: null, plan: "paygo", ... }
```

### The Upgrade Moment

The natural upgrade triggers are:

1. **Free → Paygo:** `reportUsage()` returns `allowed: false`. Your SaaS shows a prompt pointing to the billing portal where the paygo plan is listed. User subscribes with one click via Stripe Checkout (metered price). From that point, `reportUsage()` fires Stripe meter events instead of checking caps.

2. **Paygo → Volume:** Happens out-of-band — you reach out to customers consistently spending $400+/month on paygo and offer volume at half the rate. They subscribe to the volume plan through the portal. The local `MonthlyUsage` counter still tracks usage for your records; Stripe handles the billing via the volume meter.

### How Billing Works End-to-End (Paygo)

```
Month start
    │
    ├── User runs 1,000 verifications
    │      Each one → POST /api/usage/report
    │                  → MonthlyUsage.unitCount += 1
    │                  → stripe.billing.meterEvents.create("verifications", value=1)
    │
    ├── Stripe aggregates all meter events throughout the month
    │
Month end
    │
    └── Stripe generates invoice: 1,000 × $0.04 = $40.00
           → charges customer's card on file
           → fires invoice.payment_succeeded webhook
           → billing service records PaymentEvent
```

The `MonthlyUsage` table in the database is the **local source of truth** for enforcement and dashboard display. Stripe meter events are the **billing source of truth**. The two are kept in sync on every `reportUsage()` call. If a Stripe meter event fails to fire (transient API error), the local counter still incremented — a background reconciliation job can replay missed events using the `MonthlyUsage` records.
