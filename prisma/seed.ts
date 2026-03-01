/**
 * Database seeding is no longer needed for pricing.
 *
 * Each SaaS app registers its own pricing plans using:
 *   npx tsx scripts/create-app.ts <app-id> <app-name> <plans.json>
 *
 * Or add plans to an existing app:
 *   npx tsx scripts/add-plans.ts <app-id> <plans.json>
 *
 * See scripts/example-plans.json for the expected format.
 */

import { prisma } from "../lib/prisma";

async function main() {
  console.log("No global seeding required.");
  console.log(
    "Use scripts/create-app.ts to register apps with their pricing plans.",
  );
}

main()
  .then(() => console.log("Seed completed"))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
