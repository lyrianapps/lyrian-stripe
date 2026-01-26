import {
  SessionResponseSchema,
  SessionTokenSchema,
  SubscriptionRequestSchema,
  SubscriptionResponseSchema,
} from "../session/schemas";

export type BillingSession = {
  sessionId: string;
  appId: string;
  externalUserId: string;
  billingCustomerId: string;
};

export async function fetchSession(
  sessionToken: string,
): Promise<BillingSession | null> {
  try {
    SessionTokenSchema.parse(sessionToken);
    const res = await fetch("/api/billing/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken }),
    });
    const json = await res.json();
    const parsed = SessionResponseSchema.parse(json);
    return parsed.session || null;
  } catch (err) {
    console.error("Failed to fetch session:", err);
    return null;
  }
}

export async function fetchSubscription(
  appId: string,
  externalUserId: string,
): Promise<unknown | null> {
  try {
    SubscriptionRequestSchema.parse({ appId, externalUserId });
    const res = await fetch("/api/billing/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, externalUserId }),
    });
    const json = await res.json();
    const parsed = SubscriptionResponseSchema.parse(json);
    return parsed.subscription || null;
  } catch (err) {
    console.error("Failed to fetch subscription:", err);
    return null;
  }
}
