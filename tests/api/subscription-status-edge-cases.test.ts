/**
 * Extended tests for subscription status API endpoint
 *
 * Covers edge cases including:
 * - Expired subscription responses (single DB query optimization)
 * - Missing query params
 * - Non-existent app
 * - Pro plan status
 * - Subscription with cancelAtPeriodEnd
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestApp,
  createTestBillingCustomer,
  createTestSubscription,
} from "../helpers/factories";
import { createGetRequest } from "../helpers/request";

describe("GET /api/subscription/status - edge cases", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let testCustomer: Awaited<ReturnType<typeof createTestBillingCustomer>>;

  beforeEach(async () => {
    testApp = await createTestApp();
    testCustomer = await createTestBillingCustomer(testApp.id);
  });

  it("should return 400 when appId is missing", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it("should return 400 when externalUserId is missing", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it("should return null status for unknown externalUserId", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: "nonexistent-user" },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBeNull();
    expect(data.status).toBeNull();
  });

  it("should return expired status for subscription past period end", async () => {
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      currentPeriodEnd: pastEnd,
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBe("free_trial");
    expect(data.status).toBe("expired");
    expect(data.previousPlan).toBe("basic");
    expect(data.expiredAt).toBeDefined();
  });

  it("should return expired with previousPlan=pro for expired pro subscription", async () => {
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 60 * 60 * 1000);

    await createTestSubscription(testCustomer.id, {
      plan: "pro",
      status: "active",
      currentPeriodEnd: pastEnd,
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(data.status).toBe("expired");
    expect(data.previousPlan).toBe("pro");
    expect(data.plan).toBe("free_trial");
  });

  it("should return active pro plan correctly", async () => {
    await createTestSubscription(testCustomer.id, {
      plan: "pro",
      status: "active",
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBe("pro");
    expect(data.status).toBe("active");
  });

  it("should return the most recently updated subscription when multiple exist", async () => {
    const now = new Date();

    // Older subscription
    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "canceled",
      stripeSubscriptionId: `sub_old_${Date.now()}`,
      currentPeriodEnd: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
    });

    // Newer active subscription
    await createTestSubscription(testCustomer.id, {
      plan: "pro",
      status: "active",
      stripeSubscriptionId: `sub_new_${Date.now()}`,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(data.plan).toBe("pro");
    expect(data.status).toBe("active");
  });

  it("should return cancelAtPeriodEnd subscription as still active", async () => {
    const now = new Date();
    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      { appId: testApp.id, externalUserId: testCustomer.externalUserId },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    // Still active — cancel takes effect at period end
    expect(data.plan).toBe("basic");
    expect(data.status).toBe("active");
  });
});
