import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrisma() {
  // Cloud Run + Cloud SQL via Unix socket: idle pg connections get killed
  // by the CPU-throttled-at-idle policy. The next request then fails with
  // "connect EIO /cloudsql/.../.s.PGSQL.5432". Mitigations:
  //   - keep the pool tiny (Cloud Run is effectively single-concurrency)
  //   - close idle sockets quickly so we don't reuse dead ones
  //   - allow a generous connection timeout for cold starts
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
