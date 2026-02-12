import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";

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

  const billingCustomer = await prisma.billingCustomer.findUnique({
    where: {
      appId_externalUserId: { appId, externalUserId },
    },
    include: {
      subscriptions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  // No subscription found
  if (!billingCustomer || billingCustomer.subscriptions.length === 0) {
    return NextResponse.json({
      plan: null,
      status: null,
    });
  }

  const subscription = billingCustomer.subscriptions[0];

  // Check if subscription has expired
  const now = new Date();
  const isExpired = subscription.currentPeriodEnd < now;

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
  });
});

// Rate limited: 60 requests per minute (for polling)
export const GET = withRateLimit("status", statusHandler);
