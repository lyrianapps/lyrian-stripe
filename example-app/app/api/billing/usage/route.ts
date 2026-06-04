import { NextResponse } from "next/server";
import { getCurrentUsage } from "@/lib/billing";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "GET /api/billing/usage" });

/** GET /api/billing/usage — proxy to billing service (keeps API key server-side) */
export async function GET() {
  const session = await getSession();
  const yearMonth = new Date().toISOString().slice(0, 7);
  if (!session)
    return NextResponse.json(
      {
        allowed: true,
        used: 0,
        cap: null,
        remaining: null,
        plan: "unknown",
        billingType: "flat_rate",
        yearMonth,
      },
      { status: 401 },
    );
  try {
    const userId = session.userId;
    const usage = await getCurrentUsage({ externalUserId: userId });
    log.debug({ used: usage.used, plan: usage.plan }, "Usage fetched");
    return NextResponse.json(usage);
  } catch (err) {
    log.error({ err }, "Failed to fetch usage");
    // Return a neutral fallback so the UI doesn't crash
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
