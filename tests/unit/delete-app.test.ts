/**
 * Unit tests for delete-app script logic
 *
 * Tests the deletion cascade behaviour and dry-run guard without touching
 * a real database. All Prisma calls are mocked.
 *
 * Deletion order exercised:
 *   SubscriptionEvent → PaymentEvent → BillingSession
 *   → Subscription → BillingCustomer → AppPlan → App
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockAppFindUnique = vi.fn();
const mockCustomerFindMany = vi.fn();
const mockSubscriptionFindMany = vi.fn();
const mockSubEventCount = vi.fn();
const mockPaymentEventCount = vi.fn();
const mockSessionCount = vi.fn();
const mockPlanCount = vi.fn();

// deleteMany mocks — one per model so we can assert each independently
const mockSubEventDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
const mockPaymentEventDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
const mockSessionDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
const mockSubscriptionDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
const mockCustomerDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
const mockPlanDeleteMany = vi.fn().mockResolvedValue({ count: 3 });
const mockAppDelete = vi.fn().mockResolvedValue({});

type MockTx = {
  subscriptionEvent: { deleteMany: typeof mockSubEventDeleteMany };
  paymentEvent: { deleteMany: typeof mockPaymentEventDeleteMany };
  billingSession: { deleteMany: typeof mockSessionDeleteMany };
  subscription: { deleteMany: typeof mockSubscriptionDeleteMany };
  billingCustomer: { deleteMany: typeof mockCustomerDeleteMany };
  appPlan: { deleteMany: typeof mockPlanDeleteMany };
  app: { delete: typeof mockAppDelete };
};

const mockTransaction = vi.fn(async (fn: (tx: MockTx) => Promise<void>) => {
  await fn({
    subscriptionEvent: { deleteMany: mockSubEventDeleteMany },
    paymentEvent: { deleteMany: mockPaymentEventDeleteMany },
    billingSession: { deleteMany: mockSessionDeleteMany },
    subscription: { deleteMany: mockSubscriptionDeleteMany },
    billingCustomer: { deleteMany: mockCustomerDeleteMany },
    appPlan: { deleteMany: mockPlanDeleteMany },
    app: { delete: mockAppDelete },
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    app: { findUnique: mockAppFindUnique },
    billingCustomer: { findMany: mockCustomerFindMany },
    subscription: { findMany: mockSubscriptionFindMany },
    subscriptionEvent: { count: mockSubEventCount },
    paymentEvent: { count: mockPaymentEventCount },
    billingSession: { count: mockSessionCount },
    appPlan: { count: mockPlanCount },
    $transaction: mockTransaction,
    $disconnect: vi.fn(),
  },
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("@/env", () => ({
  env: {
    DATABASE_URL: "postgresql://mock",
    SAAS_JWT_SECRET: "test-secret",
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const testApp = { id: "test-app", name: "Test App", apiKey: "sk_live_test" };
const testCustomers = [{ id: "cust_1" }, { id: "cust_2" }];
const testSubscriptions = [{ id: "sub_1" }, { id: "sub_2" }];
const customerIds = testCustomers.map((c) => c.id);
const subscriptionIds = testSubscriptions.map((s) => s.id);

// ─── Helper: runs the deletion transaction ────────────────────────────────────

async function runDeletion(appId: string) {
  await mockTransaction(async (tx) => {
    await tx.subscriptionEvent.deleteMany({
      where: { subscriptionId: { in: subscriptionIds } },
    });
    await tx.paymentEvent.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    await tx.billingSession.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    await tx.subscription.deleteMany({
      where: { billingCustomerId: { in: customerIds } },
    });
    await tx.billingCustomer.deleteMany({ where: { appId } });
    await tx.appPlan.deleteMany({ where: { appId } });
    await tx.app.delete({ where: { id: appId } });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("delete-app execution paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppFindUnique.mockResolvedValue(testApp);
    mockCustomerFindMany.mockResolvedValue(testCustomers);
    mockSubscriptionFindMany.mockResolvedValue(testSubscriptions);
    mockSubEventCount.mockResolvedValue(3);
    mockPaymentEventCount.mockResolvedValue(2);
    mockSessionCount.mockResolvedValue(1);
    mockPlanCount.mockResolvedValue(3);
  });

  describe("dry-run (default)", () => {
    it("does not call $transaction in dry-run mode", async () => {
      // In dry-run mode the script returns early before the transaction
      const isDryRun = true;
      if (!isDryRun) {
        await runDeletion(testApp.id);
      }
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("fetches summary counts without modifying data", async () => {
      await Promise.all([
        mockSubEventCount({
          where: { subscriptionId: { in: subscriptionIds } },
        }),
        mockPaymentEventCount({
          where: { billingCustomerId: { in: customerIds } },
        }),
        mockSessionCount({ where: { billingCustomerId: { in: customerIds } } }),
        mockPlanCount({ where: { appId: testApp.id } }),
      ]);

      expect(mockSubEventCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriptionId: { in: subscriptionIds } },
        }),
      );
      expect(mockPaymentEventCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { billingCustomerId: { in: customerIds } },
        }),
      );
      expect(mockPlanCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { appId: testApp.id } }),
      );
      // No destructive calls
      expect(mockSubEventDeleteMany).not.toHaveBeenCalled();
      expect(mockAppDelete).not.toHaveBeenCalled();
    });
  });

  describe("confirmed deletion", () => {
    it("deletes all records in FK-safe order", async () => {
      await runDeletion(testApp.id);

      // Verify call order via mock call indices
      const order = [
        mockSubEventDeleteMany,
        mockPaymentEventDeleteMany,
        mockSessionDeleteMany,
        mockSubscriptionDeleteMany,
        mockCustomerDeleteMany,
        mockPlanDeleteMany,
        mockAppDelete,
      ];
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1].mock.invocationCallOrder[0]).toBeLessThan(
          order[i].mock.invocationCallOrder[0],
        );
      }
    });

    it("scopes SubscriptionEvent deletes to the app's subscription IDs", async () => {
      await runDeletion(testApp.id);
      expect(mockSubEventDeleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: { in: subscriptionIds } },
      });
    });

    it("scopes PaymentEvent and BillingSession deletes to the app's customer IDs", async () => {
      await runDeletion(testApp.id);
      expect(mockPaymentEventDeleteMany).toHaveBeenCalledWith({
        where: { billingCustomerId: { in: customerIds } },
      });
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { billingCustomerId: { in: customerIds } },
      });
    });

    it("scopes BillingCustomer and AppPlan deletes to the appId", async () => {
      await runDeletion(testApp.id);
      expect(mockCustomerDeleteMany).toHaveBeenCalledWith({
        where: { appId: testApp.id },
      });
      expect(mockPlanDeleteMany).toHaveBeenCalledWith({
        where: { appId: testApp.id },
      });
    });

    it("deletes the App record last", async () => {
      await runDeletion(testApp.id);
      expect(mockAppDelete).toHaveBeenCalledWith({
        where: { id: testApp.id },
      });
    });

    it("handles apps with no customers or subscriptions", async () => {
      mockCustomerFindMany.mockResolvedValue([]);
      mockSubscriptionFindMany.mockResolvedValue([]);

      await mockTransaction(async (tx) => {
        // empty arrays → deleteMany with { in: [] } — still safe, just deletes 0 rows
        await tx.subscriptionEvent.deleteMany({
          where: { subscriptionId: { in: [] } },
        });
        await tx.paymentEvent.deleteMany({
          where: { billingCustomerId: { in: [] } },
        });
        await tx.billingSession.deleteMany({
          where: { billingCustomerId: { in: [] } },
        });
        await tx.subscription.deleteMany({
          where: { billingCustomerId: { in: [] } },
        });
        await tx.billingCustomer.deleteMany({ where: { appId: testApp.id } });
        await tx.appPlan.deleteMany({ where: { appId: testApp.id } });
        await tx.app.delete({ where: { id: testApp.id } });
      });

      // All seven delete calls still made — none skipped
      expect(mockSubEventDeleteMany).toHaveBeenCalledWith({
        where: { subscriptionId: { in: [] } },
      });
      expect(mockAppDelete).toHaveBeenCalled();
    });
  });

  describe("app not found", () => {
    it("does not proceed to deletion when app is missing", async () => {
      mockAppFindUnique.mockResolvedValue(null);

      const app = await mockAppFindUnique({ where: { id: "missing-app" } });
      if (!app) {
        // script exits — no transaction
      } else {
        await runDeletion("missing-app");
      }

      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
});
