/**
 * Tests for downgrade-expired cron job
 *
 * POST /api/cron/downgrade-expired
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTestApp,
  createTestBillingCustomer,
  createTestSubscription,
  createExpiredSubscription,
} from "../helpers/factories";
import { createPostRequest } from "../helpers/request";

// Mock Stripe before importing the route
vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: vi.fn().mockRejectedValue({
        code: "resource_missing",
        type: "invalid_request_error",
      }), // Simulate deleted subscription (Stripe's actual error format)
    },
  },
}));

describe("POST /api/cron/downgrade-expired", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let testCustomer: Awaited<ReturnType<typeof createTestBillingCustomer>>;

  beforeEach(async () => {
    testApp = await createTestApp();
    testCustomer = await createTestBillingCustomer(testApp.id);
  });

  it("should reject requests without cron secret", async () => {
    const { POST } = await import("@/app/api/cron/downgrade-expired/route");

    const request = createPostRequest(
      "http://localhost:3000/api/cron/downgrade-expired",
      {},
    );

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("should process expired subscriptions", async () => {
    // Create an expired subscription
    await createExpiredSubscription(testCustomer.id);

    const { POST } = await import("@/app/api/cron/downgrade-expired/route");

    const request = createPostRequest(
      "http://localhost:3000/api/cron/downgrade-expired",
      {},
      { "x-cron-secret": "test-cron-secret" },
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.checked).toBeGreaterThanOrEqual(0);
  });

  it("should downgrade expired basic subscription to free_trial", async () => {
    // Create an expired basic subscription
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      stripeSubscriptionId: `sub_expired_${Date.now()}`,
      currentPeriodEnd: pastEnd,
    });

    const { POST } = await import("@/app/api/cron/downgrade-expired/route");

    const request = createPostRequest(
      "http://localhost:3000/api/cron/downgrade-expired",
      {},
      { "x-cron-secret": "test-cron-secret" },
    );

    await POST(request);

    // Verify the subscription was downgraded
    const subscription = await prisma.subscription.findFirst({
      where: { billingCustomerId: testCustomer.id },
    });

    expect(subscription?.plan).toBe("free_trial");
  });

  it("should not downgrade active subscriptions", async () => {
    // Create an active subscription (not expired)
    const now = new Date();
    const futureEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      currentPeriodEnd: futureEnd,
    });

    const { POST } = await import("@/app/api/cron/downgrade-expired/route");

    const request = createPostRequest(
      "http://localhost:3000/api/cron/downgrade-expired",
      {},
      { "x-cron-secret": "test-cron-secret" },
    );

    await POST(request);

    // Verify the subscription was NOT downgraded
    const subscription = await prisma.subscription.findFirst({
      where: { billingCustomerId: testCustomer.id },
    });

    expect(subscription?.plan).toBe("basic");
  });

  it("should create SubscriptionEvent when downgrading", async () => {
    // Create an expired subscription
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const subscription = await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      stripeSubscriptionId: `sub_event_test_${Date.now()}`,
      currentPeriodEnd: pastEnd,
    });

    const { POST } = await import("@/app/api/cron/downgrade-expired/route");

    const request = createPostRequest(
      "http://localhost:3000/api/cron/downgrade-expired",
      {},
      { "x-cron-secret": "test-cron-secret" },
    );

    await POST(request);

    // Check for the downgrade event
    const events = await prisma.subscriptionEvent.findMany({
      where: { subscriptionId: subscription.id },
    });

    const downgradeEvent = events.find((e) => e.type === "downgraded");
    expect(downgradeEvent).toBeDefined();
    expect(downgradeEvent?.fromPlan).toBe("basic");
    expect(downgradeEvent?.toPlan).toBe("free_trial");
  });
});
