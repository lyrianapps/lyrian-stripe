import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/app/middleware/logger";
import { env } from "@/env";
import {
  processExpiredSubscriptions,
  syncAllSubscriptionsWithStripe,
} from "@/lib/services/expirationService";

/**
 * Downgrade expired subscriptions
 *
 * POST /api/cron/downgrade-expired
 * Header: x-cron-secret: <CRON_SECRET>
 * Query: ?mode=full (optional) - sync ALL active subscriptions with Stripe
 *
 * Called by Google Cloud Scheduler to downgrade expired paid subscriptions.
 * Uses Stripe API as the source of truth to verify subscription status.
 *
 * Modes:
 * - Default: Only check subscriptions past their currentPeriodEnd
 * - ?mode=full: Check ALL active paid subscriptions against Stripe
 *               (catches deleted/canceled subscriptions regardless of period)
 */
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode");

    // Full sync checks ALL active subscriptions against Stripe
    const results =
      mode === "full"
        ? await syncAllSubscriptionsWithStripe()
        : await processExpiredSubscriptions();

    return NextResponse.json({
      success: true,
      mode: mode === "full" ? "full" : "expired-only",
      ...results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logError(error, "Cron: downgrade-expired failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = request.headers.get("x-cron-secret");
  return Boolean(env.CRON_SECRET && cronSecret === env.CRON_SECRET);
}
