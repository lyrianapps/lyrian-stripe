import { NextResponse } from "next/server";
import { getSubscriptionStatus } from "@/lib/billing";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "GET /api/billing/status" });

/** GET /api/billing/status — proxy to billing service (keeps API key server-side) */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ plan: null, status: null }, { status: 401 });
  try {
    const userId = session.userId;
    const status = await getSubscriptionStatus({ externalUserId: userId });
    log.debug(
      { plan: status.plan, status: status.status },
      "Subscription status fetched",
    );
    return NextResponse.json(status);
  } catch (err) {
    log.error({ err }, "Failed to fetch subscription status");
    // Return a safe fallback so the UI doesn't crash when billing is down
    return NextResponse.json({ plan: null, status: null });
  }
}
