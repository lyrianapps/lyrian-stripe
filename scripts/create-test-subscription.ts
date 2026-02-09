import "dotenv/config";
import { prisma } from "../lib/prisma";
import { randomBytes } from "crypto";

async function main() {
  const appId = process.argv[2];
  const externalUserId = process.argv[3];
  const minutesArg = process.argv[4];
  const minutes = minutesArg ? parseInt(minutesArg, 10) : 30;

  const trimmedAppId = appId?.toString().trim();
  const trimmedExternalUserId = externalUserId?.toString().trim();

  if (!trimmedAppId || !trimmedExternalUserId) {
    console.error(
      "Usage: npm run create-test-subscription -- <appId> <externalUserId> [minutes]",
    );
    console.error(
      "Example: npm run create-test-subscription -- myApp user123 30",
    );
    process.exit(1);
  }

  if (trimmedExternalUserId.includes(" ")) {
    console.error(
      "externalUserId must not contain spaces. Quote the argument if necessary.",
    );
    process.exit(1);
  }

  // Upsert app
  await prisma.app.upsert({
    where: { id: trimmedAppId },
    update: {},
    create: { id: trimmedAppId, name: trimmedAppId },
  });

  // Find or create billing customer
  let customer = await prisma.billingCustomer.findUnique({
    where: {
      appId_externalUserId: {
        appId: trimmedAppId,
        externalUserId: trimmedExternalUserId,
      },
    },
  });

  if (!customer) {
    customer = await prisma.billingCustomer.create({
      data: {
        appId: trimmedAppId,
        externalUserId: trimmedExternalUserId,
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
      stripePriceId: "basic_price",
      stripeProductId: "basic_product",
      plan: "basic",
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
