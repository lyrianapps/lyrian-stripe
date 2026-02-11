/**
 * Tests for subscription status API endpoint
 *
 * GET /api/subscription/status
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestApp,
  createTestBillingCustomer,
  createTestSubscription,
} from "../helpers/factories";
import { createGetRequest } from "../helpers/request";

describe("GET /api/subscription/status", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let testCustomer: Awaited<ReturnType<typeof createTestBillingCustomer>>;

  beforeEach(async () => {
    testApp = await createTestApp();
    testCustomer = await createTestBillingCustomer(testApp.id);
  });

  it("should return subscription status for valid user", async () => {
    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "active",
    });

    // Import the route handler dynamically to ensure mocks are applied
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      {
        appId: testApp.id,
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBe("basic");
    expect(data.status).toBe("active");
  });

  it("should return null for user without subscription", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      {
        appId: testApp.id,
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBeNull();
    expect(data.status).toBeNull();
  });

  it("should return 401 for invalid API key", async () => {
    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      {
        appId: testApp.id,
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": "invalid_key" },
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("should return canceled status for canceled subscription", async () => {
    await createTestSubscription(testCustomer.id, {
      plan: "basic",
      status: "canceled",
      cancelAtPeriodEnd: true,
    });

    const { GET } = await import("@/app/api/subscription/status/route");

    const request = createGetRequest(
      "http://localhost:3000/api/subscription/status",
      {
        appId: testApp.id,
        externalUserId: testCustomer.externalUserId,
      },
      { "x-api-key": testApp.apiKey! },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.plan).toBe("basic");
    expect(data.status).toBe("canceled");
  });
});
