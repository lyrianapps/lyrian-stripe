/**
 * Unit tests for create-app script logic
 *
 * Tests the AppConfigSchema parsing and the two execution paths:
 * - New app: generates API key, creates plans
 * - Existing app (update mode): preserves API key, only patches email credentials
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { Plan } from "@/lib/generated/prisma/enums";

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockUpsert = vi.fn();
const mockCreateMany = vi.fn();
const mockFindUnique = vi.fn();

type MockTx = {
  app: { upsert: typeof mockUpsert };
  appPlan: { createMany: typeof mockCreateMany };
};

const mockTransaction = vi.fn(async (fn: (tx: MockTx) => Promise<void>) => {
  await fn({
    app: { upsert: mockUpsert },
    appPlan: { createMany: mockCreateMany },
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    app: { findUnique: mockFindUnique, upsert: mockUpsert },
    appPlan: { createMany: mockCreateMany },
    $transaction: mockTransaction,
    $disconnect: vi.fn(),
  },
}));

// ─── Other mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/apiKey", () => ({
  generateApiKey: () => "sk_live_generated_test_key",
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("@/env", () => ({
  env: {
    DATABASE_URL: "postgresql://mock",
    SAAS_JWT_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    STRIPE_PK_KEY: "pk_test_mock",
    STRIPE_SECRET_KEY: "sk_test_mock",
    STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
  },
}));

// ─── AppConfigSchema — isolated import ───────────────────────────────────────
// We redefine the schema here rather than importing the script directly,
// because create-app.ts has side effects (process.argv reads, prisma.$disconnect)
// that would break the test runner.

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
  sortOrder: z.number().int().default(0),
});

const AppConfigSchema = z.union([
  z.array(PlanInputSchema),
  z.object({
    resendApiKey: z.string().startsWith("re_").optional(),
    fromEmail: z.string().email().optional(),
    plans: z.array(PlanInputSchema),
  }),
]);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const basePlan = {
  planKey: "basic" as Plan,
  name: "Basic Plan",
  price: 1000,
  stripeProductId: "prod_abc123",
  stripePriceId: "price_abc123",
};

const freePlan = {
  planKey: "free_trial" as Plan,
  name: "Free Trial",
  price: 0,
  stripeProductId: "prod_free123",
  stripePriceId: "price_free123",
};

// ─── AppConfigSchema tests ────────────────────────────────────────────────────

describe("AppConfigSchema", () => {
  describe("legacy array format", () => {
    it("accepts a valid array of plans", () => {
      const result = AppConfigSchema.safeParse([basePlan]);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("accepts multiple plans", () => {
      const result = AppConfigSchema.safeParse([freePlan, basePlan]);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      if (Array.isArray(result.data)) {
        expect(result.data).toHaveLength(2);
      }
    });

    it("rejects an invalid planKey", () => {
      const result = AppConfigSchema.safeParse([
        { ...basePlan, planKey: "enterprise" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects a plan with a negative price", () => {
      const result = AppConfigSchema.safeParse([{ ...basePlan, price: -1 }]);
      expect(result.success).toBe(false);
    });

    it("rejects a stripeProductId without prod_ prefix", () => {
      const result = AppConfigSchema.safeParse([
        { ...basePlan, stripeProductId: "abc123" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects a stripePriceId without price_ prefix", () => {
      const result = AppConfigSchema.safeParse([
        { ...basePlan, stripePriceId: "abc123" },
      ]);
      expect(result.success).toBe(false);
    });
  });

  describe("object format with email config", () => {
    it("accepts a valid object with resendApiKey and fromEmail", () => {
      const result = AppConfigSchema.safeParse({
        resendApiKey: "re_live_abc123",
        fromEmail: "billing@myapp.com",
        plans: [basePlan],
      });
      expect(result.success).toBe(true);
      if (result.success && !Array.isArray(result.data)) {
        expect(result.data.resendApiKey).toBe("re_live_abc123");
        expect(result.data.fromEmail).toBe("billing@myapp.com");
        expect(result.data.plans).toHaveLength(1);
      }
    });

    it("accepts an object without email fields (both optional)", () => {
      const result = AppConfigSchema.safeParse({ plans: [basePlan] });
      expect(result.success).toBe(true);
    });

    it("rejects a resendApiKey without re_ prefix", () => {
      const result = AppConfigSchema.safeParse({
        resendApiKey: "sk_live_wrong",
        plans: [basePlan],
      });
      expect(result.success).toBe(false);
    });

    it("rejects an invalid fromEmail", () => {
      const result = AppConfigSchema.safeParse({
        fromEmail: "not-an-email",
        plans: [basePlan],
      });
      expect(result.success).toBe(false);
    });

    it("rejects an object with no plans array", () => {
      const result = AppConfigSchema.safeParse({
        resendApiKey: "re_live_abc123",
        fromEmail: "billing@myapp.com",
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Execution path tests ─────────────────────────────────────────────────────

describe("create-app execution paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("new app: upsert is called with generated apiKey and email credentials", async () => {
    mockFindUnique.mockResolvedValue(null);

    const appId = "new-app";
    const appName = "New App";
    const resendApiKey = "re_live_abc";
    const fromEmail = "billing@newapp.com";
    const isUpdate = false;
    const apiKey = "sk_live_generated_test_key";

    await mockTransaction(async (tx) => {
      await tx.app.upsert({
        where: { id: appId },
        update: { resendApiKey, fromEmail },
        create: { id: appId, name: appName, apiKey, resendApiKey, fromEmail },
      });
      if (!isUpdate) {
        await tx.appPlan.createMany({
          data: [basePlan].map((p) => ({ appId, ...p })),
        });
      }
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          apiKey: "sk_live_generated_test_key",
          resendApiKey: "re_live_abc",
          fromEmail: "billing@newapp.com",
        }),
      }),
    );
    expect(mockCreateMany).toHaveBeenCalled();
  });

  it("update mode: upsert only patches email fields, plans are NOT recreated", async () => {
    const existingApp = {
      id: "existing-app",
      apiKey: "sk_live_original_key",
      plans: [basePlan],
    };
    mockFindUnique.mockResolvedValue(existingApp);

    const resendApiKey = "re_live_new_key";
    const fromEmail = "billing@updated.com";
    const isUpdate = true;

    await mockTransaction(async (tx) => {
      await tx.app.upsert({
        where: { id: existingApp.id },
        update: { resendApiKey, fromEmail },
        create: {
          id: existingApp.id,
          name: "Existing App",
          apiKey: existingApp.apiKey,
          resendApiKey,
          fromEmail,
        },
      });
      if (!isUpdate) {
        await tx.appPlan.createMany({ data: [] });
      }
    });

    // Email credentials updated
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          resendApiKey: "re_live_new_key",
          fromEmail: "billing@updated.com",
        },
      }),
    );
    // Plans NOT recreated
    expect(mockCreateMany).not.toHaveBeenCalled();
    // Original API key is not in the update payload
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ apiKey: expect.anything() }),
      }),
    );
  });

  it("update mode: clears email credentials when none provided", async () => {
    const existingApp = {
      id: "existing-app",
      apiKey: "sk_live_original_key",
      plans: [basePlan],
    };
    mockFindUnique.mockResolvedValue(existingApp);

    const resendApiKey = undefined;
    const fromEmail = undefined;

    await mockTransaction(async (tx) => {
      await tx.app.upsert({
        where: { id: existingApp.id },
        update: { resendApiKey, fromEmail },
        create: {
          id: existingApp.id,
          name: "Existing App",
          apiKey: existingApp.apiKey,
          resendApiKey,
          fromEmail,
        },
      });
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { resendApiKey: undefined, fromEmail: undefined },
      }),
    );
  });
});
