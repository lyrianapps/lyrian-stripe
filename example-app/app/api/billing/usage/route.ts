import { NextResponse } from "next/server";
import { getCurrentUsage } from "@/lib/billing";
import { getDemoUserId } from "@/lib/demoMode";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "GET /api/billing/usage" });

/** GET /api/billing/usage — proxy to billing service (keeps API key server-side) */
export async function GET() {
  try {
    const userId = await getDemoUserId();
    const usage = await getCurrentUsage({ externalUserId: userId });
    log.debug({ used: usage.used, plan: usage.plan }, "Usage fetched");
    return NextResponse.json(usage);
  } catch (err) {
    log.error({ err }, "Failed to fetch usage");
    // Return a neutral fallback so the UI doesn't crash
    const yearMonth = new Date().toISOString().slice(0, 7);
    return NextResponse.json({
      allowed: true,
      used: 0,
      cap: null,
      remaining: null,
      plan: "unknown",
      billingType: "flat_rate",
      yearMonth,
    });
  }
}
