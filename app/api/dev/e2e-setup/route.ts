import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { logger } from "@/app/middleware/logger";
import { Plan, PaymentEventType } from "@/lib/generated/prisma/enums";

const log = logger.child({ route: "POST /api/dev/e2e-setup" });

const E2ESetupSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  plan: z.enum(["free_trial", "basic", "pro", "paygo"]).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  hasFailedPayment: z.boolean().optional(),
  duplicateCardDetected: z.boolean().optional(),
  // For paygo: pre-seed this many units into MonthlyUsage so the test
  // starts with non-zero usage without needing to create real todos.
  seedUsageCount: z.number().int().min(0).optional(),
  // Shift the subscription period start this many days into the past
  // (default 0 = started today). Use e.g. 15 to simulate mid-cycle.
  periodStartDaysAgo: z.number().int().min(0).max(60).optional(),
});

/**
 * E2E Test Setup Endpoint
 *
 * POST /api/dev/e2e-setup
 *
 * Creates an app, billing customer, optional subscription, and returns a session token.
 * Only available in development mode.
 */
export async function POST(req: NextRequest) {
  // Only available when ENABLE_E2E_SHORTCUTS=true (set on dev/staging Cloud Run; never set on prod)
  if (process.env.ENABLE_E2E_SHORTCUTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = E2ESetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    appId,
    externalUserId,
    plan,
    cancelAtPeriodEnd = false,
    hasFailedPayment = false,
    duplicateCardDetected = false,
    seedUsageCount = 0,
    periodStartDaysAgo = 0,
  } = parsed.data;

  try {
    // Create or get the app
    await prisma.app.upsert({
      where: { id: appId },
      update: {},
      create: {
        id: appId,
        name: appId,
        apiKey: `key_${randomBytes(12).toString("hex")}`,
      },
    });

    // Seed test AppPlan records so the subscription page renders plan cards.
    // Uses upsert so re-running the fixture for the same appId is safe.
    const testPlans = [
      {
        planKey: "basic",
        name: "Basic",
        description: "For individuals",
        price: 1000, // $10/mo
        stripeProductId: `prod_test_basic`,
        stripePriceId: `price_test_basic`,
        sortOrder: 1,
      },
      {
        planKey: "pro",
        name: "Pro",
        description: "For teams",
        price: 2900, // $29/mo
        stripeProductId: `prod_test_pro`,
        stripePriceId: `price_test_pro`,
        sortOrder: 2,
      },
    ];
    for (const plan of testPlans) {
      await prisma.appPlan.upsert({
        where: { appId_planKey: { appId, planKey: plan.planKey } },
        update: {},
        create: { appId, ...plan },
      });
    }

    // Create or get the billing customer
    let customer = await prisma.billingCustomer.findUnique({
      where: { appId_externalUserId: { appId, externalUserId } },
    });

    if (!customer) {
      customer = await prisma.billingCustomer.create({
        data: {
          appId,
          externalUserId,
          stripeCustomerId: `cus_test_${randomBytes(8).toString("hex")}`,
          duplicateCardDetected,
        },
      });
    } else if (duplicateCardDetected) {
      customer = await prisma.billingCustomer.update({
        where: { id: customer.id },
        data: { duplicateCardDetected: true },
      });
    }

    // Create subscription if plan is specified
    let subscription = null;
    if (plan) {
      const now = new Date();
      const start = new Date(
        now.getTime() - periodStartDaysAgo * 24 * 60 * 60 * 1000,
      );
      const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from start

      subscription = await prisma.subscription.create({
        data: {
          billingCustomerId: customer.id,
          stripeSubscriptionId: `sub_e2e_${randomBytes(8).toString("hex")}`,
          stripePriceId: `price_test_${plan}`,
          stripeProductId: `prod_test_${plan}`,
          plan: plan as Plan,
          status: hasFailedPayment ? "past_due" : "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd,
        },
      });

      // Create a failed payment event if requested
      if (hasFailedPayment) {
        await prisma.paymentEvent.create({
          data: {
            billingCustomerId: customer.id,
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            stripeInvoiceId: `in_test_${randomBytes(8).toString("hex")}`,
            type: PaymentEventType.payment_failed,
            amount: 2900, // $29.00
            currency: "usd",
            failureCode: "card_declined",
            failureMessage: "Your card was declined.",
            attemptCount: 1,
            nextRetryAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
          },
        });
      }
    }

    // Create a billing session with proper bs_ prefix
    const sessionId = `bs_${randomBytes(32).toString("hex")}`;
    const session = await prisma.billingSession.create({
      data: {
        id: sessionId,
        billingCustomerId: customer.id,
        appId,
        externalUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Pre-seed MonthlyUsage so the test starts with non-zero usage
    if (seedUsageCount > 0) {
      const yearMonth = new Date().toISOString().slice(0, 7);
      await prisma.monthlyUsage.upsert({
        where: {
          billingCustomerId_yearMonth: {
            billingCustomerId: customer.id,
            yearMonth,
          },
        },
        update: { unitCount: { increment: seedUsageCount } },
        create: {
          billingCustomerId: customer.id,
          appId,
          yearMonth,
          unitCount: seedUsageCount,
        },
      });
    }

    // Return the session ID directly (not a JWT) - this is what the app expects
    return NextResponse.json({
      success: true,
      sessionToken: session.id,
      customerId: customer.id,
      subscriptionId: subscription?.id,
    });
  } catch (error) {
    log.error({ err: error }, "e2e-setup");
    return NextResponse.json(
      { error: "Failed to setup test data" },
      { status: 500 },
    );
  }
}
