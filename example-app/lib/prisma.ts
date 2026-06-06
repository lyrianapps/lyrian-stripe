import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  // Cloud Run + Cloud SQL via Unix socket: idle pg connections can silently
  // die (CPU-throttled-at-idle policy + Cloud SQL proxy socket closures),
  // causing "connect EIO /cloudsql/.../.s.PGSQL.5432" on the next request.
  //
  // Pool settings tuned for Cloud Run's 30s request budget: small pool
  // (Cloud Run is single-concurrency), moderate idle timeout, modest
  // connect timeout so retries can fit within the request deadline.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrisma();
  }
  return globalForPrisma.prisma;
}

/**
 * Discard the current Prisma client and replace it with a fresh one.
 * Use after a transient connection error (e.g. EIO from a dead Cloud SQL
 * socket) — the next call to getPrisma() returns a client with a new pool.
 */
export async function resetPrisma(): Promise<void> {
  const old = globalForPrisma.prisma;
  globalForPrisma.prisma = undefined;
  if (old) {
    try {
      await old.$disconnect();
    } catch {
      // best-effort
    }
  }
}

// Back-compat default export — most call sites import { prisma } and use it
// directly. New callers that may hit Cloud SQL stale-socket errors should
// prefer getPrisma() so they pick up a recreated client after a reset.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma() as unknown as Record<string | symbol, unknown>;
    return client[prop as string];
  },
});

/**
 * Eager warmup. Calling $connect() at module load makes the first incoming
 * request wait for the Cloud SQL Auth Proxy sidecar to come up, instead of
 * racing it and getting "connect EIO". Failures here are swallowed because
 * the per-request retry loop is the actual safety net.
 *
 * Polls because on a cold-started Cloud Run instance the proxy can take
 * several seconds to mount the Unix socket and start accepting connections.
 */
async function warmup() {
  const MAX_TRIES = 10;
  const BACKOFF_MS = 1_000;
  for (let i = 1; i <= MAX_TRIES; i++) {
    try {
      // $queryRaw is a real round-trip; $connect() can be lazy with adapters.
      await getPrisma().$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i === MAX_TRIES) {
        console.warn(`[prisma] warmup gave up after ${MAX_TRIES} tries:`, msg);
        return;
      }
      console.warn(
        `[prisma] warmup attempt ${i}/${MAX_TRIES} failed (${msg}); retrying in ${BACKOFF_MS}ms`,
      );
      await resetPrisma();
      await new Promise((r) => setTimeout(r, BACKOFF_MS));
    }
  }
}

if (process.env.NODE_ENV === "production") {
  void warmup();
}
