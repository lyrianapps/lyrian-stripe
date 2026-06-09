import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";

export interface VerifyCheck {
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: {
    stripeKey: VerifyCheck;
    publishableKey: VerifyCheck;
    webhookSecret: VerifyCheck;
    plans: VerifyCheck & { count: number };
  };
}

/**
 * GET /api/apps/[appId]/verify
 *
 * Validates that the app's Stripe credentials are configured and working:
 *   - stripeKey      : calls stripe.accounts.retrieve() to confirm the key is valid
 *   - publishableKey : checks the pk_... value is present
 *   - webhookSecret  : checks the whsec_... value is present
 *   - plans          : counts active AppPlan rows
 *
 * Authentication: x-api-key header.
 */
export const GET = withApiKey(
  async (
    _req: NextRequest,
    { appId }: { appId: string },
  ): Promise<NextResponse> => {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      include: { plans: { where: { isActive: true } } },
    });

    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const checks: VerifyResult["checks"] = {
      stripeKey: { ok: false, detail: "Not configured" },
      publishableKey: { ok: false, detail: "Not configured" },
      webhookSecret: { ok: false, detail: "Not configured" },
      plans: { ok: false, count: 0, detail: "No active plans" },
    };

    // Publishable key — just check it's present and looks right
    if (app.stripePublishableKey?.startsWith("pk_")) {
      checks.publishableKey = { ok: true, detail: "Set" };
    }

    // Webhook secret — check it's present and looks right
    if (app.stripeWebhookSecret?.startsWith("whsec_")) {
      checks.webhookSecret = { ok: true, detail: "Set" };
    }

    // Active plans
    const planCount = app.plans.length;
    if (planCount > 0) {
      checks.plans = {
        ok: true,
        count: planCount,
        detail: `${planCount} active plan${planCount === 1 ? "" : "s"}`,
      };
    }

    // Stripe secret key — verify by making a real API call
    if (app.stripeSecretKey?.startsWith("sk_")) {
      try {
        const stripe = new Stripe(app.stripeSecretKey, {
          apiVersion: "2025-12-15.clover",
        });
        const account = await stripe.accounts.retrieve();
        const label = account.email ?? account.id ?? "Connected";
        checks.stripeKey = { ok: true, detail: label };
      } catch (err) {
        const msg =
          err instanceof Stripe.errors.StripeError
            ? err.message
            : "Invalid or unauthorized key";
        checks.stripeKey = { ok: false, detail: msg };
      }
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return NextResponse.json({ ok: allOk, checks } satisfies VerifyResult);
  },
);
