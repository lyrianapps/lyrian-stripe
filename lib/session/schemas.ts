import { z } from "zod";

export const SessionPayloadSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
});

export const JWTTokenSchema = z.string().min(1);

export const JWTPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
});

export const SessionTokenSchema = z.string().min(1);
export const SessionResponseSchema = z.object({
  session: z
    .object({
      sessionId: z.string(),
      appId: z.string(),
      externalUserId: z.string(),
      billingCustomerId: z.string(),
    })
    .nullable(),
});

export const SubscriptionRequestSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
});
export const SubscriptionResponseSchema = z.object({
  subscription: z.any().nullable(),
});

// Checkout now accepts priceId directly from the SaaS app's configured plans
export const CheckoutRequestSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  // The Stripe price ID from the app's configured plans
  priceId: z.string().startsWith("price_"),
  email: z.string().email().optional(),
  // Optional return URL for redirecting back to the calling SaaS app
  // Accept only valid http(s) URLs; server should still validate origin/whitelist.
  returnUrl: z.string().url().optional(),
});
