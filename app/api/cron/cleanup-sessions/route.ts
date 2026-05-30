import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as _logger } from "@/app/middleware/logger";
import { env } from "@/env";

const logger = _logger.child({ route: "POST /api/cron/cleanup-sessions" });

/**
 * Cleanup expired billing sessions
 *
 * POST /api/cron/cleanup-sessions
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Called by Google Cloud Scheduler to remove expired sessions.
 * Sessions expire 30 minutes after creation.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get("x-cron-secret");

    if (!env.CRON_SECRET || cronSecret !== env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Delete all sessions where expiresAt < now
    const result = await prisma.billingSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    logger.info(`[cron] Cleaned up ${result.count} expired sessions`);

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    logger.error({ err: error }, "Cron: cleanup-sessions failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
