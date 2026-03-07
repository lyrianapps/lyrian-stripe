/**
 * Tests for email service
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Create mock send function that we can control
const mockSend = vi.fn();

// Mock Resend as a class
vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = {
        send: mockSend,
      };
    },
  };
});

// Mock env with email config
vi.mock("@/env", () => ({
  env: {
    DATABASE_URL: "postgresql://test",
    SAAS_JWT_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    STRIPE_PK_KEY: "pk_test_mock",
    STRIPE_SECRET_KEY: "sk_test_mock",
    STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
    RESEND_API_KEY: "re_test_mock_key",
    FROM_EMAIL: "test@example.com",
  },
}));

// Mock logger
vi.mock("@/app/middleware/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { sendSubscriptionEmail, previewEmail, EmailContext } from "@/lib/email";

describe("Email Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("previewEmail", () => {
    const baseContext: EmailContext = {
      to: "user@example.com",
      appName: "Test App",
      planName: "Pro",
    };

    it("should generate subscription_created email content", () => {
      const result = previewEmail("subscription_created", {
        ...baseContext,
        customerName: "John Doe",
        amount: 2999,
        currency: "usd",
      });

      expect(result.subject).toBe("Welcome to Test App - Pro Plan");
      expect(result.html).toContain("Welcome to Test App");
      expect(result.html).toContain("John Doe");
      expect(result.html).toContain("Pro");
      expect(result.html).toContain("29.99 USD");
    });

    it("should generate subscription_upgraded email content", () => {
      const result = previewEmail("subscription_upgraded", {
        ...baseContext,
        previousPlanName: "Basic",
        amount: 4999,
        currency: "usd",
      });

      expect(result.subject).toBe("You've upgraded to Pro - Test App");
      expect(result.html).toContain("Upgrade Confirmed");
      expect(result.html).toContain("Basic");
      expect(result.html).toContain("Pro");
      expect(result.html).toContain("49.99 USD");
    });

    it("should generate subscription_downgraded email content", () => {
      const result = previewEmail("subscription_downgraded", {
        ...baseContext,
        planName: "Basic",
        previousPlanName: "Pro",
        amount: 999,
        currency: "usd",
      });

      expect(result.subject).toBe("Your plan has been changed - Test App");
      expect(result.html).toContain("Plan Changed");
      expect(result.html).toContain("Pro");
      expect(result.html).toContain("Basic");
    });

    it("should generate subscription_canceled email content", () => {
      const result = previewEmail("subscription_canceled", baseContext);

      expect(result.subject).toBe("Subscription Canceled - Test App");
      expect(result.html).toContain("sorry to see you go");
      expect(result.html).toContain("Pro");
      expect(result.html).toContain("resubscribe");
    });

    it("should generate payment_failed email content", () => {
      const result = previewEmail("payment_failed", {
        ...baseContext,
        amount: 2999,
        currency: "usd",
      });

      expect(result.subject).toBe(
        "Payment Failed - Action Required - Test App",
      );
      expect(result.html).toContain("Payment Failed");
      expect(result.html).toContain("29.99 USD");
      expect(result.html).toContain("update your payment method");
    });

    it("should handle missing customerName gracefully", () => {
      const result = previewEmail("subscription_created", baseContext);

      expect(result.html).toContain("Hi there");
    });

    it("should handle null amount gracefully", () => {
      const result = previewEmail("subscription_created", {
        ...baseContext,
        amount: null,
      });

      expect(result.html).not.toContain("USD");
      expect(result.html).not.toContain("charged");
    });
  });

  describe("sendSubscriptionEmail", () => {
    const validContext: EmailContext = {
      to: "user@example.com",
      appName: "Test App",
      planName: "Pro",
      amount: 2999,
      currency: "usd",
    };

    it("should send email successfully", async () => {
      mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

      const result = await sendSubscriptionEmail(
        "subscription_created",
        validContext,
      );

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          subject: "Welcome to Test App - Pro Plan",
        }),
      );
    });

    it("should return false when recipient email is missing", async () => {
      const result = await sendSubscriptionEmail("subscription_created", {
        ...validContext,
        to: "",
      });

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should return false when Resend returns an error", async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: "Invalid API key" },
      });

      const result = await sendSubscriptionEmail(
        "subscription_created",
        validContext,
      );

      expect(result).toBe(false);
    });

    it("should return false and not throw when send throws", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      const result = await sendSubscriptionEmail(
        "subscription_created",
        validContext,
      );

      expect(result).toBe(false);
    });

    it("should include correct from address", async () => {
      mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

      await sendSubscriptionEmail("subscription_created", validContext);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "test@example.com",
        }),
      );
    });

    it("should send upgrade email with plan change details", async () => {
      mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

      const result = await sendSubscriptionEmail("subscription_upgraded", {
        ...validContext,
        previousPlanName: "Basic",
      });

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "You've upgraded to Pro - Test App",
        }),
      );
    });

    it("should send payment failed email with amount", async () => {
      mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

      const result = await sendSubscriptionEmail(
        "payment_failed",
        validContext,
      );

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Payment Failed - Action Required - Test App",
        }),
      );
    });
  });
});
