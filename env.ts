import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  SAAS_JWT_SECRET: z.string().min(1),

  // App URL
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Cron Jobs (Cloud Scheduler)
  CRON_SECRET: z.string().min(16).optional(),

  // Stripe Keys
  STRIPE_PK_KEY: z.string().startsWith("pk_"),
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("rk_")
    .or(z.string().startsWith("sk_")),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),

  // Stripe Price IDs
  STRIPE_FREE_PRICE_ID: z.string().startsWith("price_"),
  STRIPE_BASIC_PRICE_ID: z.string().startsWith("price_"),

  // Stripe Product IDs
  STRIPE_FREE_PRODUCT_ID: z.string().startsWith("prod_"),
  STRIPE_BASIC_PRODUCT_ID: z.string().startsWith("prod_"),
  // Dev admin token for gating dev-only routes (set in non-production only)
  DEV_ADMIN_TOKEN: z.string().min(8).optional(),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  return result.data;
}

export const env = validateEnv();

export type Env = z.infer<typeof envSchema>;
