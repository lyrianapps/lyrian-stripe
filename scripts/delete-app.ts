/**
 * Unregister a SaaS app and delete all associated data.
 *
 * Runs as a dry-run by default — shows what would be deleted without touching
 * the database. Pass --confirm to permanently delete.
 *
 * Usage:
 *   npx tsx scripts/delete-app.ts <app-id>             # dry-run
 *   npx tsx scripts/delete-app.ts <app-id> --confirm   # permanent delete
 *
 * Deletion order (FK-safe):
 *   SubscriptionEvent → PaymentEvent → BillingSession
 *   → Subscription → BillingCustomer → AppPlan → App
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const appId = process.argv[2];
  const isDryRun = !process.argv.includes("--confirm");

  if (!appId) {
    console.error(
      "❌ Usage: npx tsx scripts/delete-app.ts <app-id> [--confirm]",
    );
    process.exit(1);
  }

  const app = await prisma.app.findUnique({ where: { id: appId } });
  if (!app) {
    console.error(`❌ App '${appId}' not found.`);
    process.exit(1);
  }

  // Collect IDs for children — needed to reach grandchildren safely
  const customers = await prisma.billingCustomer.findMany({
    where: { appId },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  const subscriptions = await prisma.subscription.findMany({
    where: { billingCustomerId: { in: customerIds } },
    select: { id: true },
  });
  const subscriptionIds = subscriptions.map((s) => s.id);

  // Gather counts for the summary report
  const [subEventCount, paymentEventCount, sessionCount, planCount] =
    await Promise.all([
      prisma.subscriptionEvent.count({
        where: { subscriptionId: { in: subscriptionIds } },
      }),
      prisma.paymentEvent.count({
        where: { billingCustomerId: { in: customerIds } },
      }),
      prisma.billingSession.count({
        where: { billingCustomerId: { in: customerIds } },
      }),
      prisma.appPlan.count({ where: { appId } }),
    ]);

  console.log(`\n📊 Data summary for app: ${appId} ("${app.name}")\n`);
  console.log(`   App plans:            ${planCount}`);
  console.log(`   Customers:            ${customerIds.length}`);
  console.log(`   Subscriptions:        ${subscriptionIds.length}`);
  console.log(`   Subscription events:  ${subEventCount}`);
  console.log(`   Payment events:       ${paymentEventCount}`);
  console.log(`   Billing sessions:     ${sessionCount}`);

  if (isDryRun) {
    console.log("\n⚠️  DRY RUN — no data was modified.");
    console.log(
      "   Re-run with --confirm to permanently delete everything listed above.\n",
    );
    return;
  }

  console.log("\n🗑️  Deleting all data...");

  await prisma.$transaction(async (tx) => {
    const subEventsDeleted = await tx.subscriptionEvent.deleteMany({
      where: { subscriptionId: { in: subscriptionIds } },
    });
    console.log(`   ✓ Subscription events:  ${subEventsDeleted.count}`);

    const paymentEventsDeleted = await tx.paymentEvent.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    console.log(`   ✓ Payment events:       ${paymentEventsDeleted.count}`);

    const sessionsDeleted = await tx.billingSession.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    console.log(`   ✓ Billing sessions:     ${sessionsDeleted.count}`);

    const subsDeleted = await tx.subscription.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    console.log(`   ✓ Subscriptions:        ${subsDeleted.count}`);

    const customersDeleted = await tx.billingCustomer.deleteMany({
      where: { appId },
    });
    console.log(`   ✓ Customers:            ${customersDeleted.count}`);

    const plansDeleted = await tx.appPlan.deleteMany({ where: { appId } });
    console.log(`   ✓ App plans:            ${plansDeleted.count}`);

    await tx.app.delete({ where: { id: appId } });
    console.log(`   ✓ App record deleted`);
  });

  console.log(
    `\n✅ App '${appId}' and all associated data have been deleted.\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
