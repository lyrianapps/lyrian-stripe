// lib/stripe.ts
import Stripe from "stripe";
import { env } from "@/env";
import { decryptField } from "@/lib/crypto";

// Global stripe instance — only available when STRIPE_SECRET_KEY env var is set
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" })
  : null;

/** Returns a Stripe instance using the app's own secret key, falling back to the global key. */
export function getStripeForApp(appStripeSecretKey?: string | null): Stripe {
  const key = decryptField(appStripeSecretKey) ?? env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "No Stripe secret key available. Configure STRIPE_SECRET_KEY or provide a per-app key.",
    );
  }
  return new Stripe(key, { apiVersion: "2025-12-15.clover" });
}

/** Returns the webhook secret for an app, falling back to the global secret. */
export function getWebhookSecretForApp(
  appWebhookSecret?: string | null,
): string {
  const secret = decryptField(appWebhookSecret) ?? env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "No Stripe webhook secret available. Configure STRIPE_WEBHOOK_SECRET or provide a per-app secret.",
    );
  }
  return secret;
}
