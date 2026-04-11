/**
 * Tests for db-health-check endpoint
 *
 * GET /api/db-health-check
 */
import { describe, it, expect } from "vitest";
import { createTestRequest } from "../helpers/request";

describe("GET /api/db-health-check", () => {
  it("should return 401 without cron secret", async () => {
    const { GET } = await import("@/app/api/db-health-check/route");

    const request = createTestRequest(
      "http://localhost:3000/api/db-health-check",
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("should return 401 with wrong cron secret", async () => {
    const { GET } = await import("@/app/api/db-health-check/route");

    const request = createTestRequest(
      "http://localhost:3000/api/db-health-check",
      { headers: { "x-cron-secret": "wrong-secret" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("should return 200 with correct cron secret", async () => {
    const { GET } = await import("@/app/api/db-health-check/route");

    const request = createTestRequest(
      "http://localhost:3000/api/db-health-check",
      { headers: { "x-cron-secret": "test-cron-secret" } },
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
  });
});
