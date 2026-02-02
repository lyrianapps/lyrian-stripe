import { prisma } from "../lib/prisma";
import { env } from "../env";

async function main() {
  await prisma.planConfig.createMany({
    data: [
      {
        plan: "free_trial",
        stripeProductId: env.STRIPE_FREE_PRODUCT_ID,
        stripePriceId: env.STRIPE_FREE_PRICE_ID,
      },
      {
        plan: "basic",
        stripeProductId: env.STRIPE_BASIC_PRODUCT_ID,
        stripePriceId: env.STRIPE_BASIC_PRICE_ID,
      },
    ],
    skipDuplicates: true,
  });
}

main()
  .then(() => console.log("PlanConfig seeded"))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
