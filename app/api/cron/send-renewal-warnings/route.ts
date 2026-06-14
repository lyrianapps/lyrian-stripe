import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/app/middleware/logger";
import { env } from "@/env";
import {
  sendRenewalWarnings,
  sendUsageBillWarnings,
} from "@/lib/services/expirationService";

const log = logger.child({ route: "POST /api/cron/send-renewal-warnings" });

/**
 * Send subscription renewal and upcoming bill warning emails.
 *
 * POST /api/cron/send-renewal-warnings
 * Header: x-cron-secret: <CRON_SECRET>
 * Query: ?days=3  (optional, default 3 — warn this many days before period end)
 *
 * - Flat-rate (basic/pro): sends "subscription_expiring_soon" email
 * - Metered (paygo/volume): sends "usage_bill_upcoming" email with estimated bill
 *
 * Deduplicates via subscriptionEvent("renewal_warning_sent") — safe to run daily.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") ?? "3", 10), 14);

    const [flatRateResults, meteredResults] = await Promise.all([
      sendRenewalWarnings(days),
      sendUsageBillWarnings(days),
    ]);

    log.info(
      { flatRateResults, meteredResults },
      "Renewal warning cron complete",
    );

    return NextResponse.json({
      success: true,
      daysAhead: days,
      flatRate: flatRateResults,
      metered: meteredResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    log.error({ err: error }, "Cron: send-renewal-warnings failed");
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
