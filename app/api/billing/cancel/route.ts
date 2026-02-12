import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { withApiKey } from "@/lib/auth/apiKey";
import { logError } from "@/app/middleware/logger";
import { env } from "@/env";
import { getKnownErrorResponse } from "@/lib/utils/errorHandlers";
import { z } from "zod";
import { withRateLimit } from "@/lib/middleware/rateLimit";

const CancelRequestSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  cancelImmediately: z.boolean().optional().default(false),
});

/**
 * Cancel a Stripe subscription
 *
 * @param stripeSubscriptionId - The Stripe subscription ID to cancel
 * @param cancelImmediately - How to cancel:
 *
 *   false (default):
 *     → Sets cancel_at_period_end: true
 *     → User keeps access until their current billing period ends
 *     → No refund issued, subscription just won't renew
 *     → Good for: "I want to cancel but finish what I paid for"
 *
 *   true:
 *     → Cancels the subscription right now
 *     → User loses access immediately
 *     → May need to handle prorated refunds separately
 *     → Good for: Fraud, chargebacks, or user demands immediate cancellation
 */
async function cancelStripeSubscription(
  stripeSubscriptionId: string,
  cancelImmediately: boolean,
): Promise<void> {
  // Guard: ensure we are not using a restricted key (rk_) which lacks
  // subscription write permissions. Restricted keys are intended for limited
  // access and cannot perform subscription mutations.
  const key = env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("rk_")) {
    throw new Error(
      "RESTRICTED_KEY: Stripe secret key is restricted or missing. Use a full secret key (sk_...) with subscription write permissions.",
    );
  }
  if (cancelImmediately) {
    await stripe.subscriptions.cancel(stripeSubscriptionId);
  } else {
    await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }
}

/**
 * Cancel a subscription
 *
 * By default, cancels at period end (user keeps access until billing period ends)
 * Set cancelImmediately: true to cancel right away
 */
const cancelHandler = withApiKey(async (req: NextRequest) => {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = CancelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { appId, externalUserId, cancelImmediately } = parsed.data;

  try {
    // Find the billing customer
    const customer = await prisma.billingCustomer.findUnique({
      where: { appId_externalUserId: { appId, externalUserId } },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    // Find their active subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        billingCustomerId: customer.id,
        status: { notIn: ["canceled", "incomplete"] },
      },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 },
      );
    }

    // Check if it's a real Stripe subscription (not a free_trial placeholder)
    if (subscription.stripeSubscriptionId.startsWith("free_trial_")) {
      // For free trial, just mark it as canceled locally
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "canceled",
          accessEndsAt: new Date(),
        },
      });

      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          type: "canceled",
          fromPlan: subscription.plan,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Free trial canceled",
        canceledAt: new Date().toISOString(),
      });
    }

    // Cancel in Stripe
    await cancelStripeSubscription(
      subscription.stripeSubscriptionId,
      cancelImmediately,
    );

    // Update local record (webhook will also update, but good to be immediate)
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        cancelAtPeriodEnd: !cancelImmediately,
        ...(cancelImmediately && {
          status: "canceled",
          accessEndsAt: new Date(),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: cancelImmediately
        ? "Subscription canceled immediately"
        : "Subscription will cancel at end of billing period",
      cancelAtPeriodEnd: !cancelImmediately,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    });
  } catch (err) {
    logError(err, "billing/cancel");

    const known = getKnownErrorResponse(err);
    if (known) {
      return NextResponse.json(known.body, { status: known.status });
    }

    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 },
    );
  }
});

// Rate limited: 5 requests per minute
export const POST = withRateLimit("cancel", cancelHandler);
