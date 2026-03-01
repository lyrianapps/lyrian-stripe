/**
 * Add or update pricing plans for an existing SaaS app
 *
 * Usage:
 *   npx tsx scripts/add-plans.ts <app-id> <plans-json-file>
 *
 * Example:
 *   npx tsx scripts/add-plans.ts saas-todo-app ./plans.json
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../lib/prisma";
import { Plan } from "../lib/generated/prisma/enums";
import { z } from "zod";

// Valid planKey values must match the Plan enum
const VALID_PLAN_KEYS = Object.values(Plan) as string[];

const PlanInputSchema = z.object({
  planKey: z
    .string()
    .min(1)
    .refine((key): key is Plan => VALID_PLAN_KEYS.includes(key), {
      message: `Invalid planKey. Must be one of: ${VALID_PLAN_KEYS.join(", ")}`,
    }),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().int().min(0),
  currency: z.string().default("usd"),
  stripeProductId: z.string().startsWith("prod_"),
  stripePriceId: z.string().startsWith("price_"),
  sortOrder: z.number().int().optional(),
});

async function main() {
  const appId = process.argv[2];
  const plansFile = process.argv[3];

  if (!appId || !plansFile) {
    console.error(
      "❌ Usage: npx tsx scripts/add-plans.ts <app-id> <plans-json-file>",
    );
    console.error(
      "   Example: npx tsx scripts/add-plans.ts my-saas-app ./plans.json",
    );
    process.exit(1);
  }

  // Check app exists
  const app = await prisma.app.findUnique({ where: { id: appId } });
  if (!app) {
    console.error(
      `❌ App "${appId}" not found. Create it first with create-app.ts`,
    );
    process.exit(1);
  }

  // Parse plans
  let plans;
  try {
    const plansJson = JSON.parse(readFileSync(plansFile, "utf-8"));
    const parsed = z.array(PlanInputSchema).safeParse(plansJson);
    if (!parsed.success) {
      console.error("❌ Invalid plans JSON:", parsed.error.flatten());
      process.exit(1);
    }
    plans = parsed.data;
  } catch (err) {
    console.error(`❌ Failed to read plans file: ${plansFile}`);
    console.error(err);
    process.exit(1);
  }

  // Upsert plans
  for (const [index, plan] of plans.entries()) {
    await prisma.appPlan.upsert({
      where: {
        appId_planKey: { appId, planKey: plan.planKey },
      },
      update: {
        name: plan.name,
        description: plan.description,
        price: plan.price,
        currency: plan.currency || "usd",
        stripeProductId: plan.stripeProductId,
        stripePriceId: plan.stripePriceId,
        sortOrder: plan.sortOrder ?? index,
      },
      create: {
        appId,
        planKey: plan.planKey,
        name: plan.name,
        description: plan.description,
        price: plan.price,
        currency: plan.currency || "usd",
        stripeProductId: plan.stripeProductId,
        stripePriceId: plan.stripePriceId,
        sortOrder: plan.sortOrder ?? index,
      },
    });
  }

  console.log(`\n✅ Plans updated for app "${appId}":\n`);
  plans.forEach((p) => {
    console.log(
      `   - ${p.planKey}: ${p.name} ($${(p.price / 100).toFixed(2)}/month)`,
    );
  });
  console.log();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
