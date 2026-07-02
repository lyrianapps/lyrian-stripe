/**
 * Tests for cancel subscription API endpoint
 *
 * POST /api/billing/cancel
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTestApp,
  createTestBillingCustomer,
  createTestSubscription,
} from "../helpers/factories";
import { createPostRequest } from "../helpers/request";

// Mock Stripe
const mockStripeUpdate = vi.fn().mockResolvedValue({
  id: "sub_test",
  cancel_at_period_end: true,
});

vi.mock("@/lib/stripe", () => ({
  getStripeForApp: vi.fn(() => ({
    subscriptions: {
      update: mockStripeUpdate,
      cancel: vi.fn().mockResolvedValue({ id: "sub_test", status: "canceled" }),
    },
  })),
}));

describe("POST /api/billing/cancel", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let testCustomer: Awaited<ReturnType<typeof createTestBillingCustomer>>;

  beforeEach(async () => {
    testApp = await createTestApp();
    testCustomer = await createTestBillingCustomer(testApp.id);
    vi.clearAllMocks();
  });

  it("should cancel subscription at period end by default", async () => {
    const subscription = await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
    });

    const { POST } = await import("@/app/api/billing/cancel/route");

    const request = createPostRequest(
      "http://localhost:3000/api/billing/cancel",
      {
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify Stripe was called with cancel_at_period_end
    expect(mockStripeUpdate).toHaveBeenCalledWith(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );
  });

  it("should return 401 for invalid API key", async () => {
    await createTestSubscription(testCustomer.id);

    const { POST } = await import("@/app/api/billing/cancel/route");

    const request = createPostRequest(
      "http://localhost:3000/api/billing/cancel",
      {
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": "invalid_key" },
    );

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("should return 404 for user without subscription", async () => {
    const { POST } = await import("@/app/api/billing/cancel/route");

    const request = createPostRequest(
      "http://localhost:3000/api/billing/cancel",
      {
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await POST(request);

    expect(response.status).toBe(404);
  });

  it("should update database with cancelAtPeriodEnd", async () => {
    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      cancelAtPeriodEnd: false,
    });

    const { POST } = await import("@/app/api/billing/cancel/route");

    const request = createPostRequest(
      "http://localhost:3000/api/billing/cancel",
      {
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    await POST(request);

    // Verify database was updated
    const updatedSub = await prisma.subscription.findFirst({
      where: { billingCustomerId: testCustomer.id },
    });

    expect(updatedSub?.cancelAtPeriodEnd).toBe(true);
  });
});
