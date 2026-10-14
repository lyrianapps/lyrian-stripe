/**
 * Tests for billing portal endpoint
 *
 * GET /api/billing/portal
 *
 * Covers:
 * - Rate limiting re-enabled
 * - Missing token
 * - Invalid/malformed JWT
 * - Valid JWT creates session and redirects
 * - returnUrl validation (open redirect prevention)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestRequest } from "../helpers/request";
import jwt from "jsonwebtoken";

const testAppId = "test-app-id";
const mockCreateSession = vi.fn(async ({ appId }: { appId: string }) => {
  return `bs_mock_${appId}`;
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    app: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/session", () => ({
  createSession: mockCreateSession,
  verifyJWT: vi.fn(async (token: string) => {
    const payload = jwt.decode(token) as { iss?: string } | null;
    if (!payload?.iss) {
      throw new Error("JWT missing iss claim");
    }
    return jwt.verify(token, "test-jwt-secret-for-testing");
  }),
}));

// Portal reads BILLING_APP_URL from process.env directly
process.env.BILLING_APP_URL = "http://localhost:3000";

describe("GET /api/billing/portal", () => {
  beforeEach(() => {
    mockCreateSession.mockClear();
  });

  it("should redirect to /unauthorized when token is missing", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const request = createTestRequest(
      "http://localhost:3000/api/billing/portal",
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/unauthorized");
  });

  it("should redirect to /unauthorized for invalid JWT", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const request = createTestRequest(
      "http://localhost:3000/api/billing/portal?token=not-a-valid-jwt",
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/unauthorized");
  });

  it("should redirect to /unauthorized for JWT signed with wrong secret", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const badToken = jwt.sign(
      { iss: testAppId, sub: "user-123" },
      "wrong-secret",
      { expiresIn: "1h" },
    );

    const request = createTestRequest(
      `http://localhost:3000/api/billing/portal?token=${badToken}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/unauthorized");
  });

  it("should redirect to /unauthorized for expired JWT", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const expiredToken = jwt.sign(
      { iss: testAppId, sub: "user-123" },
      "test-jwt-secret-for-testing",
      { expiresIn: "-1s" }, // Already expired
    );

    const request = createTestRequest(
      `http://localhost:3000/api/billing/portal?token=${expiredToken}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/unauthorized");
  });

  it("should create session cookie and redirect to /subscription for valid JWT", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const validToken = jwt.sign(
      { iss: testAppId, sub: "user-123" },
      "test-jwt-secret-for-testing",
      { expiresIn: "1h" },
    );

    const request = createTestRequest(
      `http://localhost:3000/api/billing/portal?token=${validToken}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/subscription");
    expect(response.headers.get("set-cookie")).toContain("billing_session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("should ignore unsafe returnUrl (open redirect prevention)", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const tokenWithBadReturnUrl = jwt.sign(
      {
        iss: testAppId,
        sub: "user-123",
        returnUrl: "javascript:alert(1)",
      },
      "test-jwt-secret-for-testing",
      { expiresIn: "1h" },
    );

    const request = createTestRequest(
      `http://localhost:3000/api/billing/portal?token=${tokenWithBadReturnUrl}`,
    );

    const response = await GET(request);

    // Should still redirect but not to the malicious URL
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("javascript:");
    expect(location).toContain("/subscription");
  });

  it("should ignore malformed returnUrl", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const tokenWithBadReturnUrl = jwt.sign(
      {
        iss: testAppId,
        sub: "user-123",
        returnUrl: "not a url at all !!!",
      },
      "test-jwt-secret-for-testing",
      { expiresIn: "1h" },
    );

    const request = createTestRequest(
      `http://localhost:3000/api/billing/portal?token=${tokenWithBadReturnUrl}`,
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/subscription");
  });

  it("should keep redirect on custom-domain origin to preserve billing session cookie", async () => {
    const { GET } = await import("@/app/api/billing/portal/route");

    const previousBillingAppUrl = process.env.BILLING_APP_URL;
    process.env.BILLING_APP_URL =
      "https://lyrian-stripe-prod-494926016713.us-central1.run.app";

    try {
      const validToken = jwt.sign(
        { iss: testAppId, sub: "user-123" },
        "test-jwt-secret-for-testing",
        { expiresIn: "1h" },
      );

      const request = createTestRequest(
        `https://billing.otpmagiclink.com/api/billing/portal?token=${validToken}`,
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain(
        "https://billing.otpmagiclink.com/subscription",
      );
      expect(response.headers.get("location")).not.toContain(
        "us-central1.run.app",
      );
      expect(response.headers.get("set-cookie")).toContain("billing_session");
    } finally {
      process.env.BILLING_APP_URL = previousBillingAppUrl;
    }
  });
});
