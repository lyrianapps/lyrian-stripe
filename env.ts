import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Auth — optional fallback for legacy apps that don't have a per-app jwtSecret
  // stored in the DB, and for dev tooling (mock-login, create-portal). New apps
  // should provide their own JWT secret via register-app.yml.
  SAAS_JWT_SECRET: z.string().min(1).optional(),

  // App URL
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  BILLING_APP_URL: z.string().url().default("http://localhost:3000"),

  // Cron Jobs (Cloud Scheduler)
  CRON_SECRET: z.string().min(16).optional(),

  // Stripe Keys — optional fallbacks; apps may provide their own via DB
  STRIPE_PK_KEY: z.string().startsWith("pk_").optional(),
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("rk_")
    .or(z.string().startsWith("sk_"))
    .optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().startsWith("re_").optional(),
  FROM_EMAIL: z.string().email().optional(),

  // Dev admin token for gating dev-only routes (set in non-production only)
  DEV_ADMIN_TOKEN: z.string().min(8).optional(),

  // Field-level encryption key for sensitive DB values (Stripe keys, etc.)
  // Must be exactly 64 hex characters (32 bytes / 256 bits).
  // Generate with: openssl rand -hex 32
  FIELD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Must be 64 hex characters (32 bytes)")
    .optional(),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([field, errors]) => `  ${field}: ${(errors ?? []).join(", ")}`)
      .join("\n");
    console.error("❌ Invalid environment variables:\n" + details);
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return result.data;
}

export const env = validateEnv();

export type Env = z.infer<typeof envSchema>;
