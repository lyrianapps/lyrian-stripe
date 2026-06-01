import { z } from "zod";

const envSchema = z.object({
  BILLING_API_URL: z.string().url(),
  BILLING_API_KEY: z.string().min(1),
  BILLING_APP_ID: z.string().min(1),
  SAAS_JWT_SECRET: z.string().min(1),
  TEST_USER_ID: z.string().default("test-user-001"),
  TEST_USER_ID_PAYGO: z.string().default("test-user-paygo"),
  TEST_USER_EMAIL: z.string().email().default("test@example.com"),
  APP_URL: z.string().url().default("http://localhost:3001"),
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
