/**
 * Schema sanity check
 *
 * Verifies the live database is in sync with the Prisma schema by:
 *   1. Checking `prisma migrate status` — fails if any migrations are pending
 *   2. Running a lightweight SELECT 1 row against every model — catches column
 *      renames, missing tables, and type mismatches that Prisma surfaces at
 *      query time
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/schema-sanity-check.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — pending migrations or a model query failed
 */

import "dotenv/config";
import { execSync } from "child_process";
import { prisma } from "../lib/prisma";

async function main() {
  // ─── 1. Migration status ────────────────────────────────────────────────────

  console.log("Checking migration status...");
  try {
    const output = execSync("npx prisma migrate status", {
      encoding: "utf8",
      env: { ...process.env },
    });
    if (output.includes("Following migrations have not yet been applied")) {
      console.error("FAILED: There are unapplied migrations.\n" + output);
      process.exit(1);
    }
    console.log("✓ All migrations applied\n");
  } catch (err) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ?? "";
    if (output.includes("Following migrations have not yet been applied")) {
      console.error("FAILED: There are unapplied migrations.\n" + output);
    } else {
      console.error("FAILED: Could not determine migration status.", err);
    }
    process.exit(1);
  }

  // ─── 2. Model probes ─────────────────────────────────────────────────────────

  console.log("Probing all models...");

  const checks: Array<{ name: string; query: () => Promise<unknown> }> = [
    { name: "App", query: () => prisma.app.findFirst() },
    { name: "AppPlan", query: () => prisma.appPlan.findFirst() },
    {
      name: "BillingCustomer",
      query: () => prisma.billingCustomer.findFirst(),
    },
    { name: "BillingSession", query: () => prisma.billingSession.findFirst() },
    { name: "PlanConfig", query: () => prisma.planConfig.findFirst() },
    { name: "Subscription", query: () => prisma.subscription.findFirst() },
    {
      name: "SubscriptionEvent",
      query: () => prisma.subscriptionEvent.findFirst(),
    },
    { name: "PaymentEvent", query: () => prisma.paymentEvent.findFirst() },
    { name: "MonthlyUsage", query: () => prisma.monthlyUsage.findFirst() },
    { name: "StripeEvent", query: () => prisma.stripeEvent.findFirst() },
  ];

  let failed = false;
  for (const { name, query } of checks) {
    try {
      await query();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}: ${(err as Error).message}`);
      failed = true;
    }
  }

  await prisma.$disconnect();

  if (failed) {
    console.error(
      "\nSchema sanity check FAILED — one or more models could not be queried.\n" +
        "This usually means a migration was not applied or the schema drifted from the DB.",
    );
    process.exit(1);
  }

  console.log("\nSchema sanity check PASSED ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
