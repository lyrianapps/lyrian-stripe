import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";

/**
 * Get payment events for a user
 *
 * GET /api/subscription/payments?appId=xxx&externalUserId=xxx&limit=10
 * Header: x-api-key: <your-api-key>
 *
 * Responses:
 * - Success: { payments: [...], hasFailedPayments: boolean }
 * - No customer: { payments: [], hasFailedPayments: false }
 */
const paymentsHandler = withApiKey(async (request: NextRequest, { appId }) => {
  const externalUserId = request.nextUrl.searchParams.get("externalUserId");
  const limitParam = request.nextUrl.searchParams.get("limit");

  if (!externalUserId) {
    return NextResponse.json(
      { error: "externalUserId required" },
      { status: 400 },
    );
  }

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 10;

  const billingCustomer = await prisma.billingCustomer.findUnique({
    where: {
      appId_externalUserId: { appId, externalUserId },
    },
    select: { id: true },
  });

  if (!billingCustomer) {
    return NextResponse.json({
      payments: [],
      hasFailedPayments: false,
    });
  }

  // Get recent payment events
  const paymentEvents = await prisma.paymentEvent.findMany({
    where: { billingCustomerId: billingCustomer.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      amount: true,
      currency: true,
      failureCode: true,
      failureMessage: true,
      attemptCount: true,
      nextRetryAt: true,
      createdAt: true,
    },
  });

  // Check for recent unresolved payment failures
  const hasFailedPayments = await prisma.paymentEvent.count({
    where: {
      billingCustomerId: billingCustomer.id,
      type: "payment_failed",
      createdAt: {
        // Consider failures in the last 30 days
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
  });

  // Check if there's a more recent successful payment
  const lastSuccess = await prisma.paymentEvent.findFirst({
    where: {
      billingCustomerId: billingCustomer.id,
      type: "payment_succeeded",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const lastFailure = await prisma.paymentEvent.findFirst({
    where: {
      billingCustomerId: billingCustomer.id,
      type: "payment_failed",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  // Only flag as having failed payments if the last failure is more recent than last success
  const hasUnresolvedFailure =
    hasFailedPayments > 0 &&
    (!lastSuccess ||
      (lastFailure && lastFailure.createdAt > lastSuccess.createdAt));

  return NextResponse.json({
    payments: paymentEvents.map((event) => ({
      id: event.id,
      type: event.type,
      amount: event.amount,
      currency: event.currency,
      failureCode: event.failureCode,
      failureMessage: event.failureMessage,
      attemptCount: event.attemptCount,
      nextRetryAt: event.nextRetryAt?.toISOString() ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    hasFailedPayments: hasUnresolvedFailure,
  });
});

// Rate limited: 60 requests per minute (same as status checks)
export const GET = withRateLimit("status", paymentsHandler);
