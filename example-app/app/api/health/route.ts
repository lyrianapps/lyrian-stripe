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
 * Retries internally with backoff because on a fresh cold start the
 * proxy can take 10-30s to mount the Unix socket.
 */
export async function GET() {
  const MAX_ATTEMPTS = 6;
  const BACKOFF_MS = [0, 2_000, 4_000, 6_000, 8_000, 10_000];
  let lastErr: unknown;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (BACKOFF_MS[i] > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: "ok", attempts: i + 1 });
    } catch (err) {
      lastErr = err;
      log.warn({ err, attempt: i + 1 }, "Health check DB query failed");
      await resetPrisma();
    }
  }
  return NextResponse.json(
    {
      status: "unhealthy",
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    },
    { status: 503 },
  );
}
