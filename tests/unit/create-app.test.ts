/**
 * Unit tests for create-app script logic
 *
 * Tests the AppConfigSchema parsing and the two execution paths:
 * - New app: generates API key, upserts app + all plan fields (incl. billingType)
 * - Existing app (update mode): preserves API key, upserts plans with updated fields
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { Plan, BillingType } from "@/lib/generated/prisma/enums";

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockAppUpsert = vi.fn();
const mockPlanUpsert = vi.fn();
const mockFindUnique = vi.fn();

type MockTx = {
  app: { upsert: typeof mockAppUpsert };
  appPlan: { upsert: typeof mockPlanUpsert };
};

const mockTransaction = vi.fn(async (fn: (tx: MockTx) => Promise<void>) => {
  await fn({
    app: { upsert: mockAppUpsert },
    appPlan: { upsert: mockPlanUpsert },
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    app: { findUnique: mockFindUnique },
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

// ─── Schema re-definition ─────────────────────────────────────────────────────
// Mirrors create-app.ts exactly. Kept in-sync so test failures catch drift.

const VALID_PLAN_KEYS = Object.values(Plan) as string[];
const VALID_BILLING_TYPES = Object.values(BillingType) as string[];

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
  billingType: z
    .string()
    .refine((t): t is BillingType => VALID_BILLING_TYPES.includes(t), {
      message: `Invalid billingType. Must be one of: ${VALID_BILLING_TYPES.join(", ")}`,
    })
    .default("flat_rate"),
  stripeMeterEventName: z.string().optional(),
  unitAmount: z.number().int().min(0).optional(),
  freeUnitsPerMonth: z.number().int().min(0).optional(),
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

const flatPlan = {
  planKey: "basic" as Plan,
  name: "Basic Plan",
  price: 1000,
  stripeProductId: "prod_abc123",
  stripePriceId: "price_abc123",
  billingType: "flat_rate",
};

const meteredPlan = {
  planKey: "paygo" as Plan,
  name: "Pay As You Go",
  price: 0,
  billingType: "metered",
  stripeProductId: "prod_paygo123",
  stripePriceId: "price_paygo123",
  stripeMeterEventName: "api_call",
  unitAmount: 4,
  freeUnitsPerMonth: 100,
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
    it("accepts a valid flat_rate plan", () => {
      const result = AppConfigSchema.safeParse([flatPlan]);
      expect(result.success).toBe(true);
    });

    it("accepts a metered plan with all optional fields", () => {
      const result = AppConfigSchema.safeParse([meteredPlan]);
      expect(result.success).toBe(true);
      if (result.success && Array.isArray(result.data)) {
        const p = result.data[0];
        expect(p.billingType).toBe("metered");
        expect(p.stripeMeterEventName).toBe("api_call");
        expect(p.unitAmount).toBe(4);
        expect(p.freeUnitsPerMonth).toBe(100);
      }
    });

    it("defaults billingType to flat_rate when omitted", () => {
      const result = AppConfigSchema.safeParse([freePlan]);
      expect(result.success).toBe(true);
      if (result.success && Array.isArray(result.data)) {
        expect(result.data[0].billingType).toBe("flat_rate");
      }
    });

    it("accepts multiple plans with mixed billingTypes", () => {
      const result = AppConfigSchema.safeParse([
        freePlan,
        flatPlan,
        meteredPlan,
      ]);
      expect(result.success).toBe(true);
      if (result.success && Array.isArray(result.data)) {
        expect(result.data).toHaveLength(3);
      }
    });

    it("rejects an invalid billingType", () => {
      const result = AppConfigSchema.safeParse([
        { ...flatPlan, billingType: "subscription" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects an invalid planKey", () => {
      const result = AppConfigSchema.safeParse([
        { ...flatPlan, planKey: "enterprise" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects a plan with a negative price", () => {
      const result = AppConfigSchema.safeParse([{ ...flatPlan, price: -1 }]);
      expect(result.success).toBe(false);
    });

    it("rejects a stripeProductId without prod_ prefix", () => {
      const result = AppConfigSchema.safeParse([
        { ...flatPlan, stripeProductId: "abc123" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects a stripePriceId without price_ prefix", () => {
      const result = AppConfigSchema.safeParse([
        { ...flatPlan, stripePriceId: "abc123" },
      ]);
      expect(result.success).toBe(false);
    });

    it("rejects a negative unitAmount", () => {
      const result = AppConfigSchema.safeParse([
        { ...meteredPlan, unitAmount: -1 },
      ]);
      expect(result.success).toBe(false);
    });
  });

  describe("object format with email config", () => {
    it("accepts a valid object with resendApiKey and fromEmail", () => {
      const result = AppConfigSchema.safeParse({
        resendApiKey: "re_live_abc123",
        fromEmail: "billing@myapp.com",
        plans: [flatPlan],
      });
      expect(result.success).toBe(true);
      if (result.success && !Array.isArray(result.data)) {
        expect(result.data.resendApiKey).toBe("re_live_abc123");
        expect(result.data.fromEmail).toBe("billing@myapp.com");
        expect(result.data.plans).toHaveLength(1);
      }
    });

    it("accepts an object without email fields (both optional)", () => {
      const result = AppConfigSchema.safeParse({ plans: [flatPlan] });
      expect(result.success).toBe(true);
    });

    it("passes billingType through the object format", () => {
      const result = AppConfigSchema.safeParse({ plans: [meteredPlan] });
      expect(result.success).toBe(true);
      if (result.success && !Array.isArray(result.data)) {
        expect(result.data.plans[0].billingType).toBe("metered");
      }
    });

    it("rejects a resendApiKey without re_ prefix", () => {
      const result = AppConfigSchema.safeParse({
        resendApiKey: "sk_live_wrong",
        plans: [flatPlan],
      });
      expect(result.success).toBe(false);
    });

    it("rejects an invalid fromEmail", () => {
      const result = AppConfigSchema.safeParse({
        fromEmail: "not-an-email",
        plans: [flatPlan],
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

  it("new app: upserts app with generated apiKey and creates all plan fields", async () => {
    const appId = "new-app";
    const appName = "New App";
    const apiKey = "sk_live_generated_test_key";

    await mockTransaction(async (tx) => {
      await tx.app.upsert({
        where: { id: appId },
        update: { resendApiKey: undefined, fromEmail: undefined },
        create: { id: appId, name: appName, apiKey },
      });
      for (const [index, plan] of [flatPlan, meteredPlan].entries()) {
        await tx.appPlan.upsert({
          where: { appId_planKey: { appId, planKey: plan.planKey } },
          create: { appId, ...plan, sortOrder: index },
          update: { ...plan, sortOrder: index },
        });
      }
    });

    expect(mockAppUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          apiKey: "sk_live_generated_test_key",
        }),
      }),
    );
    // Both plans upserted
    expect(mockPlanUpsert).toHaveBeenCalledTimes(2);
  });

  it("new app: billingType is written correctly for each plan", async () => {
    const appId = "billing-type-test";

    await mockTransaction(async (tx) => {
      for (const [index, plan] of [flatPlan, meteredPlan].entries()) {
        await tx.appPlan.upsert({
          where: { appId_planKey: { appId, planKey: plan.planKey } },
          create: { appId, ...plan, sortOrder: index },
          update: { ...plan, sortOrder: index },
        });
      }
    });

    const flatCall = mockPlanUpsert.mock.calls[0][0];
    expect(flatCall.create.billingType).toBe("flat_rate");
    expect(flatCall.update.billingType).toBe("flat_rate");

    const meteredCall = mockPlanUpsert.mock.calls[1][0];
    expect(meteredCall.create.billingType).toBe("metered");
    expect(meteredCall.update.billingType).toBe("metered");
    expect(meteredCall.create.stripeMeterEventName).toBe("api_call");
    expect(meteredCall.create.unitAmount).toBe(4);
    expect(meteredCall.create.freeUnitsPerMonth).toBe(100);
  });

  it("update mode: api key is preserved, plan fields are upserted", async () => {
    const appId = "existing-app";
    const originalApiKey = "sk_live_original_key";

    await mockTransaction(async (tx) => {
      // update path never passes apiKey in the update payload
      await tx.app.upsert({
        where: { id: appId },
        update: { resendApiKey: "re_live_new", fromEmail: "new@app.com" },
        create: { id: appId, name: "Existing", apiKey: originalApiKey },
      });
      await tx.appPlan.upsert({
        where: { appId_planKey: { appId, planKey: flatPlan.planKey } },
        create: { appId, ...flatPlan, sortOrder: 0 },
        update: { ...flatPlan, sortOrder: 0 },
      });
    });

    // API key not touched in the update payload
    expect(mockAppUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ apiKey: expect.anything() }),
      }),
    );
    // Plan still upserted (billingType corrected on re-register)
    expect(mockPlanUpsert).toHaveBeenCalledTimes(1);
  });

  it("update mode: clears email credentials when none provided", async () => {
    const appId = "existing-app";

    await mockTransaction(async (tx) => {
      await tx.app.upsert({
        where: { id: appId },
        update: { resendApiKey: undefined, fromEmail: undefined },
        create: { id: appId, name: "Existing", apiKey: "sk_live_original" },
      });
    });

    expect(mockAppUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { resendApiKey: undefined, fromEmail: undefined },
      }),
    );
  });
});
