import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { logError } from "@/app/middleware/logger";
import { Plan } from "@/lib/generated/prisma/enums";

const E2ESetupSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  plan: z.enum(["free_trial", "basic", "pro"]).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
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
  // Disabled in production
  if (process.env.NODE_ENV === "production") {
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
        },
      });
    }

    // Create subscription if plan is specified
    let subscription = null;
    if (plan) {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      subscription = await prisma.subscription.create({
        data: {
          billingCustomerId: customer.id,
          stripeSubscriptionId: `sub_test_${randomBytes(8).toString("hex")}`,
          stripePriceId: `price_test_${plan}`,
          stripeProductId: `prod_test_${plan}`,
          plan: plan as Plan,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: end,
          cancelAtPeriodEnd,
        },
      });
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

    // Return the session ID directly (not a JWT) - this is what the app expects
    return NextResponse.json({
      success: true,
      sessionToken: session.id,
      customerId: customer.id,
      subscriptionId: subscription?.id,
    });
  } catch (error) {
    logError(error, "e2e-setup");
    return NextResponse.json(
      { error: "Failed to setup test data" },
      { status: 500 },
    );
  }
}
