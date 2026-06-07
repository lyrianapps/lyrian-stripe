import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";
import { getClientIdentifierWithUser } from "@/lib/rateLimit";

/**
 * Get subscription status for a user
 *
 * GET /api/subscription/status?appId=xxx&externalUserId=xxx
 * Header: x-api-key: <your-api-key>
 *
 * Responses:
 * - Active:  { plan: "pro", status: "active" }
 * - Expired: { plan: "free_trial", status: "expired", expiredAt: "...", previousPlan: "pro" }
 * - None:    { plan: null, status: null }
 */
const statusHandler = withApiKey(async (request: NextRequest) => {
  const appId = request.nextUrl.searchParams.get("appId");
  const externalUserId = request.nextUrl.searchParams.get("externalUserId");

  if (!appId || !externalUserId) {
    return NextResponse.json(
      { error: "appId and externalUserId required" },
      { status: 400 },
    );
  }

  // Single query: fetch customer + subscription + verify app exists via relation
  const billingCustomer = await prisma.billingCustomer.findUnique({
    where: {
      appId_externalUserId: { appId, externalUserId },
    },
    include: {
      app: { select: { id: true } },
      subscriptions: {
        where: { status: { not: "incomplete" } },
        orderBy: { updatedAt: "desc" },
        select: {
          plan: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          accessEndsAt: true,
        },
      },
    },
  });

  if (billingCustomer && !billingCustomer.app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  // No subscription found
  if (!billingCustomer || billingCustomer.subscriptions.length === 0) {
    return NextResponse.json({
      plan: null,
      status: null,
    });
  }

  // Prefer active > past_due > trialing — guards against a stale free_trial/trialing
  // record being returned when a newer active paid subscription also exists.
  const STATUS_PRIORITY = ["active", "past_due", "trialing"];
  const subscription = billingCustomer.subscriptions.slice().sort((a, b) => {
    const ai = STATUS_PRIORITY.indexOf(a.status);
    const bi = STATUS_PRIORITY.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  })[0];

  // Only treat a subscription as expired if Stripe itself hasn't marked it
  // active/trialing AND the period end has passed. An active subscription is
  // never expired regardless of currentPeriodEnd — Stripe's status is authoritative.
  const now = new Date();
  const isExpired =
    subscription.status !== "active" &&
    subscription.status !== "trialing" &&
    subscription.currentPeriodEnd < now;

  if (isExpired) {
    return NextResponse.json({
      plan: "free_trial", // Downgrade to free
      status: "expired",
      expiredAt: subscription.currentPeriodEnd,
      previousPlan: subscription.plan,
    });
  }

  return NextResponse.json({
    plan: subscription.plan,
    status: subscription.status,
    ...(subscription.cancelAtPeriodEnd && {
      cancellation: {
        scheduledAt: subscription.accessEndsAt ?? subscription.currentPeriodEnd,
        message: `Your subscription will lose access on ${(subscription.accessEndsAt ?? subscription.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
      },
    }),
  });
});

// Rate limited: 60 requests per minute PER USER (not shared across all users)
export const GET = withRateLimit(
  "status",
  statusHandler,
  getClientIdentifierWithUser,
);
