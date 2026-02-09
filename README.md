# Lyrian Stripe - Centralized Billing Service

A centralized billing service that handles Stripe subscriptions for multiple SaaS applications.

## Overview

This billing app allows you to:

- Manage subscriptions for multiple SaaS products from one place
- Handle Stripe webhooks centrally
- Provide a unified billing portal UI for end users
- Let SaaS backends check subscription status via API

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

### Step 1: Register Your SaaS App

Generate an API key for your SaaS app:

```bash
npx tsx scripts/create-app.ts <app-id> "<app-name>"

# Example:
npx tsx scripts/create-app.ts saas-a "My Todo App"
```

Save the API key securely - it won't be shown again.

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

| Endpoint               | Method | Description                                   |
| ---------------------- | ------ | --------------------------------------------- |
| `/api/billing/portal`  | GET    | Entry point for billing portal (JWT in query) |
| `/api/billing/webhook` | POST   | Stripe webhook handler                        |

## Environment Variables

| Variable                  | Description                                 |
| ------------------------- | ------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection string                |
| `SAAS_JWT_SECRET`         | Shared secret for JWT signing/verification  |
| `STRIPE_SECRET_KEY`       | Stripe API secret key                       |
| `STRIPE_WEBHOOK_SECRET`   | Stripe webhook signing secret               |
| `STRIPE_PK_KEY`           | Stripe publishable key                      |
| `STRIPE_FREE_PRICE_ID`    | Stripe price ID for free tier               |
| `STRIPE_BASIC_PRICE_ID`   | Stripe price ID for basic tier              |
| `STRIPE_FREE_PRODUCT_ID`  | Stripe product ID for free tier             |
| `STRIPE_BASIC_PRODUCT_ID` | Stripe product ID for basic tier            |
| `CRON_SECRET`             | Secret for authenticating cron job requests |

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
