# Create Test Subscription API

Development-only endpoint for creating test subscriptions with various states.

**Endpoint:** `POST /api/dev/create-test-subscription`

> ⚠️ This endpoint is disabled in production.

## Parameters

| Parameter          | Type    | Required | Default | Description                      |
| ------------------ | ------- | -------- | ------- | -------------------------------- |
| `appId`            | string  | ✅       | -       | App identifier                   |
| `externalUserId`   | string  | ✅       | -       | User identifier from your app    |
| `minutes`          | number  | ❌       | 30      | Subscription duration in minutes |
| `hasFailedPayment` | boolean | ❌       | false   | Create a failed payment event    |

## Response

```json
{
  "success": true,
  "sessionToken": "bs_...",
  "subscription": {
    "id": "...",
    "stripeSubscriptionId": "dev_test_...",
    "currentPeriodEnd": "2026-02-11T...",
    "status": "active",
    "hasFailedPayment": false
  }
}
```

## Testing Flows

### 1. Basic Subscription

Create a simple active subscription:

```bash
curl -X POST http://localhost:3000/api/dev/create-test-subscription \
  -H "Content-Type: application/json" \
  -d '{"appId": "test-app", "externalUserId": "user-123"}'
```

### 2. Payment Failed Flow

Create a subscription with a failed payment to test the warning banner:

```bash
curl -X POST http://localhost:3000/api/dev/create-test-subscription \
  -H "Content-Type: application/json" \
  -d '{"appId": "test-app", "externalUserId": "user-456", "hasFailedPayment": true}'
```

This will:

- Set subscription status to `past_due`
- Create a `PaymentEvent` with type `payment_failed`
- Trigger the warning banner on `/subscription`

### 3. Short-lived Subscription (for expiry testing)

Create a subscription that expires in 2 minutes:

```bash
curl -X POST http://localhost:3000/api/dev/create-test-subscription \
  -H "Content-Type: application/json" \
  -d '{"appId": "test-app", "externalUserId": "user-789", "minutes": 2}'
```

## Using the Session Token

After creating a subscription, set the session cookie in your browser console:

```javascript
document.cookie = "billing_session=<sessionToken>; path=/"
```

Then visit http://localhost:3000/subscription to see the billing portal.

## Alternative: e2e-setup Endpoint

For E2E tests or when you need more control, use `/api/dev/e2e-setup`:

```bash
curl -X POST http://localhost:3000/api/dev/e2e-setup \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "test-app",
    "externalUserId": "user-123",
    "plan": "pro",
    "cancelAtPeriodEnd": false,
    "hasFailedPayment": true
  }'
```

| Additional Parameters | Type                                   | Description                                |
| --------------------- | -------------------------------------- | ------------------------------------------ |
| `plan`                | `"free_trial"` \| `"basic"` \| `"pro"` | Subscription plan                          |
| `cancelAtPeriodEnd`   | boolean                                | Whether subscription cancels at period end |
