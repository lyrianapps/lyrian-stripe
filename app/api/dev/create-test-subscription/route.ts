import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { logError } from "@/app/middleware/logger";
import { PaymentEventType } from "@/lib/generated/prisma/enums";

const DevCreateSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  minutes: z.number().int().positive().optional(),
  hasFailedPayment: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  // Disabled in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = DevCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    appId,
    externalUserId,
    minutes = 30,
    hasFailedPayment = false,
  } = parsed.data;

  try {
    await prisma.app.upsert({
      where: { id: appId },
      update: {},
      create: { id: appId, name: appId },
    });

    let customer = await prisma.billingCustomer.findUnique({
      where: { appId_externalUserId: { appId, externalUserId } },
    });

    if (!customer) {
      customer = await prisma.billingCustomer.create({
        data: {
          appId,
          externalUserId,
          stripeCustomerId: "placeholder_" + randomBytes(6).toString("hex"),
        },
      });
    }

    const now = new Date();
    const end = new Date(now.getTime() + minutes * 60 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        billingCustomer: { connect: { id: customer.id } },
        stripeSubscriptionId: `dev_test_${randomBytes(8).toString("hex")}`,
        stripePriceId: "dev_test_price",
        stripeProductId: "dev_test_product",
        plan: "free_trial",
        status: hasFailedPayment ? "past_due" : "active",
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
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

    // Create a billing session so user can access the subscription page
    const sessionId = `bs_${randomBytes(32).toString("hex")}`;
    await prisma.billingSession.create({
      data: {
        id: sessionId,
        billingCustomerId: customer.id,
        appId,
        externalUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    return NextResponse.json({
      success: true,
      sessionToken: sessionId,
      subscription: {
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
        hasFailedPayment,
      },
    });
  } catch (err) {
    logError(err, "dev/create-test-subscription");
    return NextResponse.json(
      { error: "Failed to create test subscription" },
      { status: 500 },
    );
  }
}
