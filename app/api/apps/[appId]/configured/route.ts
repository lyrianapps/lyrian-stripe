import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { logger } from "@/app/middleware/logger";

const log = logger.child({ route: "GET /api/apps/[appId]/configured" });

/**
 * GET /api/apps/[appId]/configured
 *
 * Lightweight endpoint — returns whether the app has been successfully
 * verified (isConfigured=true). No Stripe API calls, just a single DB read.
 *
 * Used by integrating apps to gate user access until setup is complete.
 * Authentication: x-api-key header.
 */
export const GET = withApiKey(
  async (
    _req: NextRequest,
    { appId }: { appId: string },
  ): Promise<NextResponse> => {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      select: { isConfigured: true },
    });

    if (!app) {
      log.warn({ appId }, "App not found");
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    log.debug({ appId, configured: app.isConfigured }, "Configured check");
    return NextResponse.json({ configured: app.isConfigured });
  },
);
