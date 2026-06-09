import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { Plan, BillingType } from "@/lib/generated/prisma/enums";

const VALID_PLAN_KEYS = Object.values(Plan) as string[];
const VALID_BILLING_TYPES = Object.values(BillingType) as string[];

const PlanSchema = z.object({
  planKey: z.string().refine((k): k is Plan => VALID_PLAN_KEYS.includes(k), {
    message: `planKey must be one of: ${VALID_PLAN_KEYS.join(", ")}`,
  }),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().min(0),
  currency: z.string().default("usd"),
  stripeProductId: z.string().startsWith("prod_"),
  stripePriceId: z.string().startsWith("price_"),
  sortOrder: z.number().int().default(0),
  billingType: z
    .string()
    .refine((t): t is BillingType => VALID_BILLING_TYPES.includes(t), {
      message: `billingType must be one of: ${VALID_BILLING_TYPES.join(", ")}`,
    })
    .default("flat_rate"),
  unitAmount: z.number().int().min(0).optional(),
  stripeMeterEventName: z.string().optional(),
  freeUnitsPerMonth: z.number().int().min(0).optional(),
});

const ConfigureSchema = z.object({
  stripeSecretKey: z.string().startsWith("sk_").optional(),
  stripePublishableKey: z.string().startsWith("pk_").optional(),
  stripeWebhookSecret: z.string().startsWith("whsec_").optional(),
  plans: z.array(PlanSchema).min(1).optional(),
});

/**
 * POST /api/apps/[appId]/configure
 *
 * Updates Stripe credentials and/or plan configuration for an existing app.
 * Designed for the self-serve onboarding flow — lets a developer configure
 * their own Stripe keys and plans without a deployment workflow.
 *
 * Authentication: x-api-key header (API key returned at app registration).
 *
 * Body (all fields optional — at least one required):
 *   stripeSecretKey      – sk_live_... or sk_test_...
 *   stripePublishableKey – pk_live_... or pk_test_...
 *   stripeWebhookSecret  – whsec_...
 *   plans                – Plan array (upserts active plans, deactivates removed ones)
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
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      stripeSecretKey,
      stripePublishableKey,
      stripeWebhookSecret,
      plans,
    } = parsed.data;

    if (
      !stripeSecretKey &&
      !stripePublishableKey &&
      !stripeWebhookSecret &&
      !plans
    ) {
      return NextResponse.json(
        { error: "At least one field must be provided" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      // Only patch the credential fields that were provided
      const credentialPatch: Record<string, string> = {};
      if (stripeSecretKey) credentialPatch.stripeSecretKey = stripeSecretKey;
      if (stripePublishableKey)
        credentialPatch.stripePublishableKey = stripePublishableKey;
      if (stripeWebhookSecret)
        credentialPatch.stripeWebhookSecret = stripeWebhookSecret;

      if (Object.keys(credentialPatch).length > 0) {
        await tx.app.update({ where: { id: appId }, data: credentialPatch });
      }

      if (plans && plans.length > 0) {
        const incomingKeys = plans.map((p) => p.planKey);

        // Deactivate plans not in the incoming list
        await tx.appPlan.updateMany({
          where: { appId, planKey: { notIn: incomingKeys } },
          data: { isActive: false },
        });

        for (const plan of plans) {
          await tx.appPlan.upsert({
            where: { appId_planKey: { appId, planKey: plan.planKey } },
            update: {
              name: plan.name,
              description: plan.description ?? null,
              price: plan.price,
              currency: plan.currency,
              stripeProductId: plan.stripeProductId,
              stripePriceId: plan.stripePriceId,
              sortOrder: plan.sortOrder,
              billingType: plan.billingType as BillingType,
              unitAmount: plan.unitAmount ?? null,
              stripeMeterEventName: plan.stripeMeterEventName ?? null,
              freeUnitsPerMonth: plan.freeUnitsPerMonth ?? null,
              isActive: true,
            },
            create: {
              appId,
              planKey: plan.planKey as Plan,
              name: plan.name,
              description: plan.description ?? null,
              price: plan.price,
              currency: plan.currency,
              stripeProductId: plan.stripeProductId,
              stripePriceId: plan.stripePriceId,
              sortOrder: plan.sortOrder,
              billingType: plan.billingType as BillingType,
              unitAmount: plan.unitAmount ?? null,
              stripeMeterEventName: plan.stripeMeterEventName ?? null,
              freeUnitsPerMonth: plan.freeUnitsPerMonth ?? null,
            },
          });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      appId,
      updated: {
        credentials: !!(
          stripeSecretKey ||
          stripePublishableKey ||
          stripeWebhookSecret
        ),
        plans: plans ? plans.length : 0,
      },
    });
  },
);
