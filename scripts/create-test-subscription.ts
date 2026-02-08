import { prisma } from "../lib/prisma";
import { randomBytes } from "crypto";

async function main() {
  const appId = process.argv[2];
  const externalUserId = process.argv[3];
  const minutesArg = process.argv[4];
  const minutes = minutesArg ? parseInt(minutesArg, 10) : 30;

  if (!appId || !externalUserId) {
    console.error(
      "Usage: npx tsx scripts/create-test-subscription.ts <appId> <externalUserId> [minutes]",
    );
    process.exit(1);
  }

  // Upsert app
  await prisma.app.upsert({
    where: { id: appId },
    update: {},
    create: { id: appId, name: appId },
  });

  // Find or create billing customer
  let customer = await prisma.billingCustomer.findUnique({
    where: { appId_externalUserId: { appId, externalUserId } },
  });

  if (!customer) {
    customer = await prisma.billingCustomer.create({
      data: {
        appId,
        externalUserId,
        stripeCustomerId: "placeholder_" + randomBytes(6).toString("hex"),
      },
    });
    console.log(`Created billing customer: ${customer.id}`);
  } else {
    console.log(`Found billing customer: ${customer.id}`);
  }

  const now = new Date();
  const end = new Date(now.getTime() + minutes * 60 * 1000);

  const subscription = await prisma.subscription.create({
    data: {
      billingCustomer: { connect: { id: customer.id } },
      stripeSubscriptionId: `test_sub_${randomBytes(8).toString("hex")}`,
      stripePriceId: "test_price",
      stripeProductId: "test_product",
      plan: "free_trial",
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
    },
  });

  console.log("Created test subscription:");
  console.log(`  id: ${subscription.id}`);
  console.log(`  stripeSubscriptionId: ${subscription.stripeSubscriptionId}`);
  console.log(
    `  currentPeriodEnd: ${subscription.currentPeriodEnd.toISOString()}`,
  );
  console.log("Use the subscription page to verify expiration behavior.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
