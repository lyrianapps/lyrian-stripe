import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";
import { getClientIdentifierWithUser } from "@/lib/rateLimit";
import { Plan, SubscriptionStatus } from "@/lib/generated/prisma/enums";

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

// =============================================================================
// Types
// =============================================================================

type SubscriptionRow = {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  accessEndsAt: Date | null;
};

// =============================================================================
// Data access
// =============================================================================

async function fetchSubscriptions(
  appId: string,
  externalUserId: string,
): Promise<{ notFound: true } | { appMissing: true } | SubscriptionRow[]> {
  const billingCustomer = await prisma.billingCustomer.findUnique({
    where: { appId_externalUserId: { appId, externalUserId } },
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

  if (!billingCustomer) return { notFound: true };
  if (!billingCustomer.app) return { appMissing: true };
  return billingCustomer.subscriptions;
}

// =============================================================================
// Business logic
// =============================================================================

/** Prefer active > past_due > trialing to surface the most meaningful record. */
const STATUS_PRIORITY: SubscriptionStatus[] = [
  "active",
  "past_due",
  "trialing",
];

function selectBestSubscription(
  subscriptions: SubscriptionRow[],
): SubscriptionRow {
  return subscriptions.slice().sort((a, b) => {
    const ai = STATUS_PRIORITY.indexOf(a.status);
    const bi = STATUS_PRIORITY.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  })[0];
}

/**
 * A subscription is expired when its period end has passed and Stripe hasn't
 * marked it active. For active subs, trust Stripe's status — period end may be
 * stale on records created before the webhook stored items.data[0].current_period_end.
 */
function isExpired(subscription: SubscriptionRow, now: Date): boolean {
  return (
    subscription.status !== "active" && subscription.currentPeriodEnd < now
  );
}

// =============================================================================
// Response builders
// =============================================================================

function buildExpiredResponse(subscription: SubscriptionRow) {
  return NextResponse.json({
    plan: "free_trial" as Plan,
    status: "expired",
    expiredAt: subscription.currentPeriodEnd,
    previousPlan: subscription.plan,
  });
}

function buildActiveResponse(subscription: SubscriptionRow) {
  const accessEnd = subscription.accessEndsAt ?? subscription.currentPeriodEnd;
  return NextResponse.json({
    plan: subscription.plan,
    status: subscription.status,
    ...(subscription.cancelAtPeriodEnd && {
      cancellation: {
        scheduledAt: accessEnd,
        message: `Your subscription will lose access on ${accessEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
      },
    }),
  });
}

// =============================================================================
// Handler
// =============================================================================

const statusHandler = withApiKey(async (request: NextRequest) => {
  const appId = request.nextUrl.searchParams.get("appId");
  const externalUserId = request.nextUrl.searchParams.get("externalUserId");

  if (!appId || !externalUserId) {
    return NextResponse.json(
      { error: "appId and externalUserId required" },
      { status: 400 },
    );
  }

  const result = await fetchSubscriptions(appId, externalUserId);

  if ("appMissing" in result) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }
  if ("notFound" in result || result.length === 0) {
    return NextResponse.json({ plan: null, status: null });
  }

  const subscription = selectBestSubscription(result);

  if (isExpired(subscription, new Date())) {
    return buildExpiredResponse(subscription);
  }

  return buildActiveResponse(subscription);
});

// Rate limited: 60 requests per minute PER USER (not shared across all users)
export const GET = withRateLimit(
  "status",
  statusHandler,
  getClientIdentifierWithUser,
);
