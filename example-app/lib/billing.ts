import { env } from "./env";
import jwt from "jsonwebtoken";
import pino from "pino";
import { z } from "zod";

// Minimal fetchWithTimeout for browser/node
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 10000,
): Promise<Response> {
  return (await Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeout),
    ),
  ])) as Response;
}

const logger = pino({ name: "billing" });
const log = logger.child({ module: "billing" });

// Subscription plan types
export const Plan = {
  free_trial: "free_trial",
  basic: "basic",
  pro: "pro",
  paygo: "paygo",
  volume: "volume",
} as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

// Subscription status types
export const SubscriptionStatus = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  expired: "expired",
} as const;
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export type SubscriptionCancellation = {
  scheduledAt: string;
  message: string;
};

export type SubscriptionStatusResponse = {
  plan: Plan | null;
  status: SubscriptionStatus | null;
  expiredAt?: string;
  previousPlan?: Plan;
  cancellation?: SubscriptionCancellation;
};

export type UsageResult = {
  allowed: boolean;
  used: number;
  cap: number | null;
  remaining: number | null;
  plan: Plan | string;
  billingType: string;
  yearMonth: string;
};

const subscriptionStatusSchema = z.object({
  plan: z.enum(["free_trial", "basic", "pro", "paygo", "volume"]).nullable(),
  status: z
    .enum([
      "active",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
      "expired",
    ])
    .nullable(),
  expiredAt: z.string().optional(),
  previousPlan: z
    .enum(["free_trial", "basic", "pro", "paygo", "volume"])
    .optional(),
  cancellation: z
    .object({
      scheduledAt: z.string(),
      message: z.string(),
    })
    .optional(),
});

const DEFAULT_SUBSCRIPTION: SubscriptionStatusResponse = {
  plan: "free_trial",
  status: "trialing",
};

// JWT and Portal
export function createBillingToken(
  userId: string,
  returnUrl: string,
  billingType?: string,
  email?: string,
): string {
  if (!env.SAAS_JWT_SECRET) {
    throw new Error("SAAS_JWT_SECRET is not configured");
  }
  return jwt.sign(
    {
      iss: env.BILLING_APP_ID,
      sub: userId,
      returnUrl,
      ...(billingType ? { billingType } : {}),
      ...(email ? { email } : {}),
    },
    env.SAAS_JWT_SECRET as string,
    { expiresIn: "5m" },
  );
}

export function getBillingPortalUrl(
  userId: string,
  returnUrl: string,
  billingType?: string,
  email?: string,
): string {
  if (!env.BILLING_API_URL) {
    throw new Error("BILLING_API_URL is not configured");
  }
  const token = createBillingToken(userId, returnUrl, billingType, email);
  return `${env.BILLING_API_URL}/api/billing/portal?token=${token}`;
}

export async function initiateCheckout({
  externalUserId,
  priceId,
  returnUrl,
  email,
}: {
  externalUserId: string;
  priceId: string;
  returnUrl: string;
  email?: string;
}): Promise<string> {
  if (!env.BILLING_API_URL || !env.BILLING_APP_ID || !env.BILLING_API_KEY) {
    throw new Error("Billing env vars missing — cannot initiate checkout");
  }
  const response = await fetchWithTimeout(
    `${env.BILLING_API_URL}/api/billing/checkout`,
    {
      method: "POST",
      headers: {
        "x-api-key": env.BILLING_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: env.BILLING_APP_ID,
        externalUserId,
        priceId,
        returnUrl,
        email,
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Checkout failed ${response.status}: ${text}`);
  }
  const data = (await response.json()) as { url?: string };
  if (!data.url)
    throw new Error("Billing service did not return a checkout URL");
  return data.url;
}

// Subscription Status API
export async function getSubscriptionStatus({
  externalUserId,
}: {
  externalUserId: string;
}): Promise<SubscriptionStatusResponse> {
  if (!env.BILLING_API_URL || !env.BILLING_APP_ID || !env.BILLING_API_KEY) {
    log.warn("Billing env vars missing — falling back to default subscription");
    return DEFAULT_SUBSCRIPTION;
  }
  try {
    const url = new URL(`${env.BILLING_API_URL}/api/subscription/status`);
    url.searchParams.set("appId", env.BILLING_APP_ID);
    url.searchParams.set("externalUserId", externalUserId);
    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": env.BILLING_API_KEY,
      },
    });
    if (!response.ok) {
      const errorBody = await response
        .text()
        .catch(() => "Unable to read error body");
      let errorMessage = errorBody;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error || parsed.message || errorBody;
      } catch {
        // Keep raw text if not JSON
      }
      log.warn(
        {
          status: response.status,
          error: response.status === 404 ? "Route not found" : errorMessage,
        },
        "Billing API error",
      );
      return DEFAULT_SUBSCRIPTION;
    }
    const data = await response.json();
    const parsed = subscriptionStatusSchema.safeParse(data);
    if (!parsed.success) {
      log.error(
        { zodError: parsed.error.flatten() },
        "Invalid subscription status response",
      );
      return DEFAULT_SUBSCRIPTION;
    }
    return parsed.data;
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      "Failed to fetch subscription status",
    );
    return DEFAULT_SUBSCRIPTION;
  }
}

// Usage API
export async function reportUsage({
  externalUserId,
  quantity = 1,
}: {
  externalUserId: string;
  quantity?: number;
}): Promise<UsageResult> {
  if (!env.BILLING_API_URL || !env.BILLING_APP_ID || !env.BILLING_API_KEY) {
    log.warn("Billing env vars missing — usage reporting is disabled");
    return {
      allowed: true,
      used: 0,
      cap: null,
      remaining: null,
      plan: "free_trial",
      billingType: "flat_rate",
      yearMonth: new Date().toISOString().slice(0, 7),
    };
  }
  try {
    const response = await fetchWithTimeout(
      `${env.BILLING_API_URL}/api/usage/report`,
      {
        method: "POST",
        headers: {
          "x-api-key": env.BILLING_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId: env.BILLING_APP_ID,
          externalUserId,
          quantity,
        }),
      },
    );
    if (!response.ok && response.status !== 402) {
      throw new Error(`Usage report ${response.status}`);
    }
    return response.json();
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      "Failed to report usage",
    );
    return {
      allowed: true,
      used: 0,
      cap: null,
      remaining: null,
      plan: "free_trial",
      billingType: "flat_rate",
      yearMonth: new Date().toISOString().slice(0, 7),
    };
  }
}

export async function getCurrentUsage({
  externalUserId,
  yearMonth,
}: {
  externalUserId: string;
  yearMonth?: string;
}): Promise<UsageResult> {
  if (!env.BILLING_API_URL || !env.BILLING_APP_ID || !env.BILLING_API_KEY) {
    log.warn("Billing env vars missing — usage querying is disabled");
    return {
      allowed: true,
      used: 0,
      cap: null,
      remaining: null,
      plan: "free_trial",
      billingType: "flat_rate",
      yearMonth: yearMonth || new Date().toISOString().slice(0, 7),
    };
  }
  try {
    const params = new URLSearchParams({
      appId: env.BILLING_APP_ID,
      externalUserId,
    });
    if (yearMonth) params.set("yearMonth", yearMonth);
    const response = await fetchWithTimeout(
      `${env.BILLING_API_URL}/api/usage/current?${params}`,
      {
        method: "GET",
        headers: {
          "x-api-key": env.BILLING_API_KEY,
        },
      },
    );
    if (!response.ok) throw new Error(`Usage fetch ${response.status}`);
    return response.json();
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      "Failed to fetch usage",
    );
    return {
      allowed: true,
      used: 0,
      cap: null,
      remaining: null,
      plan: "free_trial",
      billingType: "flat_rate",
      yearMonth: yearMonth || new Date().toISOString().slice(0, 7),
    };
  }
}

// Cancel Subscription API
export async function cancelSubscription({
  externalUserId,
}: {
  externalUserId: string;
}): Promise<void> {
  if (!env.BILLING_API_URL || !env.BILLING_APP_ID || !env.BILLING_API_KEY) {
    log.warn("Billing env vars missing — skipping subscription cancellation");
    return;
  }
  try {
    const url = new URL(`${env.BILLING_API_URL}/api/subscription/cancel`);
    url.searchParams.set("appId", env.BILLING_APP_ID);
    url.searchParams.set("externalUserId", externalUserId);
    const response = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { "x-api-key": env.BILLING_API_KEY },
    });
    if (!response.ok) {
      log.warn(
        { status: response.status, externalUserId },
        "Billing cancel returned non-2xx — proceeding with account deletion anyway",
      );
    } else {
      log.info(
        { externalUserId },
        "Subscription cancelled before account deletion",
      );
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      "Failed to cancel subscription — proceeding with account deletion anyway",
    );
  }
}
