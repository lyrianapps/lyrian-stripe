import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { logger } from "@/app/middleware/logger";
import {
  ConfigureSchema,
  resolveEffectiveBillingMode,
  checkPlanBillingModeCompatibility,
  applyCredentials,
  applyPlans,
} from "@/lib/apps/configure";

const log = logger.child({ route: "POST /api/apps/[appId]/configure" });

/**
 * POST /api/apps/[appId]/configure
 *
 * Updates Stripe credentials and/or plan configuration for an existing app.
 * Designed for the self-serve onboarding flow — lets a developer configure
 * their own Stripe keys and plans without a deployment workflow.
 *
 * Authentication: x-api-key header (API key returned at app registration).
 */
export const POST = withApiKey(
  async (
    req: NextRequest,
    { appId }: { appId: string },
  ): Promise<NextResponse> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = ConfigureSchema.safeParse(body);
    if (!parsed.success) {
      log.warn({ appId, errors: parsed.error.flatten() }, "Validation failed");
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      stripeSecretKey,
      stripePublishableKey,
      stripeWebhookSecret,
      billingMode,
      plans,
    } = parsed.data;

    if (
      !stripeSecretKey &&
      !stripePublishableKey &&
      !stripeWebhookSecret &&
      !billingMode &&
      !plans
    ) {
      return NextResponse.json(
        { error: "At least one field must be provided" },
        { status: 400 },
      );
    }

    if (plans) {
      const effectiveMode = await resolveEffectiveBillingMode(
        appId,
        billingMode,
      );
      if (effectiveMode) {
        const modeError = checkPlanBillingModeCompatibility(
          plans,
          effectiveMode,
        );
        if (modeError) {
          log.warn({ appId, effectiveMode }, "Plan billing type mismatch");
          return NextResponse.json({ error: modeError }, { status: 422 });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await applyCredentials(tx, appId, {
        stripeSecretKey,
        stripePublishableKey,
        stripeWebhookSecret,
        billingMode,
      });
      if (plans?.length) await applyPlans(tx, appId, plans);
    });

    log.info(
      {
        appId,
        updatedCredentials: !!(
          stripeSecretKey ||
          stripePublishableKey ||
          stripeWebhookSecret
        ),
        updatedPlans: plans?.length ?? 0,
      },
      "App configured",
    );

    return NextResponse.json({
      ok: true,
      appId,
      updated: {
        credentials: !!(
          stripeSecretKey ||
          stripePublishableKey ||
          stripeWebhookSecret
        ),
        plans: plans?.length ?? 0,
      },
    });
  },
);
