import { beforeAll, afterAll, afterEach, vi } from "vitest";
import { config } from "dotenv";

// Load .env.test before anything else. This MUST run before vi.mock() below,
// but vi.mock() is hoisted to the very top of the file by Vitest — so we also
// call dotenv at the top of the mock factory as a belt-and-braces measure.
config({ path: ".env.test" });

// Mock the env module BEFORE any imports that use it.
// The factory function runs at mock hoist time (before top-level dotenv above),
// so we re-run dotenv inside the factory to guarantee TEST_DATABASE_URL is set.
vi.mock("@/env", async () => {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.test" });

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required. Set it in .env.test or as an environment variable.\n" +
        "Example: TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/lyrian_billing_test",
    );
  }

  return {
    env: {
      DATABASE_URL: testDatabaseUrl,
      SAAS_JWT_SECRET: "test-jwt-secret-for-testing",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      CRON_SECRET: "test-cron-secret",
      BILLING_APP_URL: "http://localhost:3000",
    },
  };
});

// Import prisma AFTER mocking env
import { prisma } from "@/lib/prisma";

// Clean up database before/after tests
beforeAll(async () => {
  // Clean slate before running tests
  console.log("🧪 Test suite starting...");
  await cleanupDatabase();
});

afterEach(async () => {
  // Clean up test data after each test
  await cleanupDatabase();
});

async function cleanupDatabase() {
  // Use raw SQL for cascade-safe deletion or delete in reverse dependency order
  // PlanConfig has no dependencies, delete first if exists
  try {
    await prisma.subscriptionEvent.deleteMany({});
  } catch {}
  try {
    await prisma.subscription.deleteMany({});
  } catch {}
  try {
    await prisma.billingSession.deleteMany({});
  } catch {}
  try {
    await prisma.billingCustomer.deleteMany({});
  } catch {}
  try {
    await prisma.stripeEvent.deleteMany({});
  } catch {}
  try {
    await prisma.planConfig.deleteMany({});
  } catch {}
  try {
    await prisma.app.deleteMany({});
  } catch {}
}

afterAll(async () => {
  await prisma.$disconnect();
  console.log("🧪 Test suite complete.");
});
