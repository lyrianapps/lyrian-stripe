import { logger } from "@/app/middleware/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { env } from "@/env";

const log = logger.child({ route: "GET /api/db-health-check" });

export async function GET(request: NextRequest) {
  // Require cron secret to prevent public access
  const secret = request.headers.get("x-cron-secret");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      message: "Database connection healthy.",
    });
  } catch (error) {
    log.error({ err: error }, "db-health-check GET");
    return NextResponse.json(
      {
        status: "error",
        message: "Database connection failed.",
        error: String(error),
      },
      { status: 500 },
    );
    // NOTE: Do NOT call prisma.$disconnect() here — it closes the shared
    // connection pool for the entire Cloud Run instance, breaking all
    // subsequent requests until the pool is re-established.
  }
}
