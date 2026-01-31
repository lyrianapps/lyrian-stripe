import { prisma } from "../lib/prisma";

async function main() {
  await prisma.planConfig.createMany({
    data: [
      {
        plan: "free_trial",
        stripeProductId: process.env.STRIPE_FREE_PRODUCT_ID!,
        stripePriceId: process.env.STRIPE_FREE_PRICE_ID!,
      },
      {
        plan: "basic",
        stripeProductId: process.env.STRIPE_BASIC_PRODUCT_ID!,
        stripePriceId: process.env.STRIPE_BASIC_PRICE_ID!,
      },
    ],
    skipDuplicates: true,
  });
}

main()
  .then(() => console.log("PlanConfig seeded"))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
