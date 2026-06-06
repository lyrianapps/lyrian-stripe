import { NextResponse } from "next/server";
import { prisma, resetPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "GET /api/health" });

/**
 * GET /api/health
 *
 * Exercises the database with `SELECT 1` so the Cloud SQL Auth Proxy
 * sidecar is forced to come up. CI polls this endpoint after deploy so
 * the cold-start cost is paid before user-facing tests run, instead of
 * racing the proxy on the first POST /api/todos.
 *
 * The outer CI loop is responsible for polling across cold-start; this
 * endpoint just makes one good-faith attempt and returns 503 (with the
 * actual error in the body) when the DB still isn't ready.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    log.warn({ err }, "Health check DB query failed");
    await resetPrisma();
    return NextResponse.json(
      {
        status: "unhealthy",
        error: err instanceof Error ? err.message : String(err),
        databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      },
      { status: 503 },
    );
  }
}
