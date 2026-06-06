import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  // Cloud Run + Cloud SQL via Unix socket: idle pg connections silently die
  // (CPU-throttled-at-idle policy + Cloud SQL proxy socket closures), and
  // the next request gets "connect EIO /cloudsql/.../.s.PGSQL.5432".
  // We aggressively short-circuit any pooling so each request gets a
  // fresh connection that's known to be alive.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: 1,
    idleTimeoutMillis: 1, // close idle sockets immediately
    connectionTimeoutMillis: 10_000,
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
