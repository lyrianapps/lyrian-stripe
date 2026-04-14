/**
 * Generate API key for a SaaS app and configure pricing plans
 *
 * Usage:
 *   npx tsx scripts/create-app.ts <app-id> <app-name> [plans-json-file]
 *
 * Example:
 *   npx tsx scripts/create-app.ts saas-todo-app "My Todo App"
 *   npx tsx scripts/create-app.ts saas-todo-app "My Todo App" ./plans.json
 *
 * Plans JSON format:
 * [
 *   {
 *     "planKey": "basic",
 *     "name": "Basic Plan",
 *     "description": "For individuals",
 *     "price": 1000,
 *     "stripeProductId": "prod_xxx",
 *     "stripePriceId": "price_xxx"
 *   }
 * ]
 */

import "dotenv/config"; // Load .env before anything else
import { readFileSync } from "fs";
import { prisma } from "../lib/prisma";
import { generateApiKey } from "../lib/auth/apiKey";
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
  price: z.number().int().min(0), // in cents
  currency: z.string().default("usd"),
  stripeProductId: z.string().startsWith("prod_"),
  stripePriceId: z.string().startsWith("price_"),
  sortOrder: z.number().int().default(0),
});

/**
 * App config schema — supports two formats:
 *
 * 1. Simple array (legacy):    [ { planKey: "basic", ... }, ... ]
 * 2. Object with email config: { resendApiKey: "re_live_...", fromEmail: "billing@yourapp.com", plans: [...] }
 *
 * The email fields are optional and let each SaaS app send emails from its own
 * domain instead of the billing portal's global FROM_EMAIL / RESEND_API_KEY.
 */
const AppConfigSchema = z.union([
  z.array(PlanInputSchema),
  z.object({
    resendApiKey: z.string().startsWith("re_").optional(),
    fromEmail: z.string().email().optional(),
    plans: z.array(PlanInputSchema),
  }),
]);

type PlanInput = z.infer<typeof PlanInputSchema>;

async function main() {
  const appId = process.argv[2];
  const appName = process.argv[3] || appId;
  const plansFile = process.argv[4];

  if (!appId) {
    console.error(
      "❌ Usage: npx tsx scripts/create-app.ts <app-id> <app-name> <plans-json-file>",
    );
    console.error(
      "   Example: npx tsx scripts/create-app.ts my-saas-app 'My SaaS App' ./plans.json",
    );
    console.error(`
📋 Plans JSON format:
   [
     {
       "planKey": "basic",
       "name": "Basic Plan",
       "description": "For individuals",
       "price": 1000,
       "stripeProductId": "prod_xxx",
       "stripePriceId": "price_xxx"
     }
   ]

💡 Create your Stripe products/prices at https://dashboard.stripe.com/products
   then map them to a plans.json file.
`);
    process.exit(1);
  }

  // Require plans file - apps without pricing are not useful
  if (!plansFile) {
    console.error(`
❌ Missing plans file!

   You must provide a plans JSON file with your Stripe product/price IDs.

   Usage: npx tsx scripts/create-app.ts <app-id> <app-name> <plans-json-file>
   
   Example: npx tsx scripts/create-app.ts ${appId} "${appName}" ./my-plans.json

📋 Plans JSON format:
   [
     {
       "planKey": "basic",
       "name": "Basic Plan", 
       "description": "For individuals",
       "price": 1000,
       "stripeProductId": "prod_xxx",
       "stripePriceId": "price_xxx"
     }
   ]

💡 Steps:
   1. Create your products/prices in Stripe Dashboard
   2. Copy the prod_xxx and price_xxx IDs
   3. Create a JSON file with your plans
   4. Run this command again with the file path
`);
    process.exit(1);
  }

  // Check if app already exists
  const existingApp = await prisma.app.findUnique({
    where: { id: appId },
    include: { plans: true },
  });

  if (existingApp?.apiKey) {
    console.log(
      `\n⚠️  App "${appId}" already registered — running in update mode.`,
    );
    console.log(`   API Key: (unchanged)`);

    if (existingApp.plans.length > 0) {
      console.log(`\n   Existing plans:`);
      existingApp.plans.forEach((p) => {
        console.log(
          `   - ${p.planKey}: ${p.name} ($${(p.price / 100).toFixed(2)}/${p.interval})`,
        );
      });
    }
    console.log();
    // Fall through — parse the config file and upsert email credentials
  }

  const isUpdate = Boolean(existingApp?.apiKey);
  const apiKey = isUpdate ? existingApp!.apiKey! : generateApiKey();

  // Parse app config (supports legacy array format OR new object format)
  let plans: PlanInput[] = [];
  let resendApiKey: string | undefined;
  let fromEmail: string | undefined;
  try {
    const rawJson = JSON.parse(readFileSync(plansFile, "utf-8"));
    const parsed = AppConfigSchema.safeParse(rawJson);
    if (!parsed.success) {
      console.error("❌ Invalid app config JSON:", parsed.error.flatten());
      process.exit(1);
    }
    if (Array.isArray(parsed.data)) {
      plans = parsed.data;
    } else {
      plans = parsed.data.plans;
      resendApiKey = parsed.data.resendApiKey;
      fromEmail = parsed.data.fromEmail;
    }
  } catch (err) {
    console.error(`❌ Failed to read app config file: ${plansFile}`);
    console.error(err);
    process.exit(1);
  }

  if (plans.length === 0) {
    console.error(`
❌ Plans file is empty!

   Your plans.json must contain at least one pricing plan.
   
   Example:
   [
     {
       "planKey": "basic",
       "name": "Basic Plan",
       "price": 1000,
       "stripeProductId": "prod_xxx",
       "stripePriceId": "price_xxx"
     }
   ]
`);
    process.exit(1);
  }

  // Create/update app with plans in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.app.upsert({
      where: { id: appId },
      // On update: only patch email credentials — never overwrite the API key or plans
      update: { resendApiKey, fromEmail },
      create: {
        id: appId,
        name: appName,
        apiKey,
        resendApiKey,
        fromEmail,
      },
    });

    if (plans.length > 0 && !isUpdate) {
      await tx.appPlan.createMany({
        data: plans.map((plan, index) => ({
          appId,
          planKey: plan.planKey,
          name: plan.name,
          description: plan.description,
          price: plan.price,
          currency: plan.currency || "usd",
          stripeProductId: plan.stripeProductId,
          stripePriceId: plan.stripePriceId,
          sortOrder: plan.sortOrder ?? index,
        })),
      });
    }
  });

  if (isUpdate) {
    console.log(`
✅ App updated successfully!

   App ID:     ${appId}
   API Key:    (unchanged)
   From Email: ${fromEmail || "(uses billing portal default)"}
   Resend Key: ${resendApiKey ? "set" : "(uses billing portal default)"}
`);
  } else {
    console.log(`
✅ App created successfully!

   App ID:   ${appId}
   Name:     ${appName}
   API Key:  ${apiKey}${resendApiKey ? `\n   From Email: ${fromEmail || "(uses billing portal default)"}` : ""}

   Plans configured:`);
    plans.forEach((p) => {
      console.log(
        `   - ${p.planKey}: ${p.name} ($${(p.price / 100).toFixed(2)}/month)`,
      );
    });

    if (!resendApiKey) {
      console.log(`
⚠️  No resendApiKey configured — emails will use the billing portal's global
   RESEND_API_KEY / FROM_EMAIL env vars. To send from your own domain, add
   resendApiKey and fromEmail to your app config JSON.`);
    }

    console.log(`
Save this API key securely - it won't be shown again.

Usage in your SaaS app:
   
   curl -X GET "https://your-billing-app.com/api/subscription/status?appId=${appId}&externalUserId=user-123" \\
     -H "x-api-key: ${apiKey}"
`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
