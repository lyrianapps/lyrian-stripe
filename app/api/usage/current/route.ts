import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";

import { logger } from "@/app/middleware/logger";
import { getCurrentUsage } from "@/lib/services/usageService";

const log = logger.child({ route: "GET /api/usage/current" });
const currentHandler = withApiKey(async (req: NextRequest) => {
  const appId = req.nextUrl.searchParams.get("appId");
  const externalUserId = req.nextUrl.searchParams.get("externalUserId");
  const yearMonth = req.nextUrl.searchParams.get("yearMonth") ?? undefined;

  if (!appId || !externalUserId) {
    log.warn("Missing appId or externalUserId");
    return NextResponse.json(
      { error: "appId and externalUserId are required" },
      { status: 400 },
    );
  }

  const result = await getCurrentUsage({ appId, externalUserId, yearMonth });
  log.info(
    { appId, externalUserId, used: result.used, plan: result.plan },
    "Usage queried",
  );
  return NextResponse.json(result);
});

export const GET = withRateLimit("usage", currentHandler);
