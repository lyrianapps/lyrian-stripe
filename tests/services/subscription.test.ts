/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for subscription service layer
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTestApp,
  createTestBillingCustomer,
  createTestSubscription,
} from "../helpers/factories";

// Mock Stripe
vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

import { stripe } from "@/lib/stripe";

describe("Subscription Service", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let testCustomer: Awaited<ReturnType<typeof createTestBillingCustomer>>;

  beforeEach(async () => {
    testApp = await createTestApp();
    testCustomer = await createTestBillingCustomer(testApp.id);
    vi.clearAllMocks();
  });

  describe("downgradeSubscription", () => {
    it("should downgrade subscription to free_trial", async () => {
      const subscription = await createTestSubscription(testCustomer.id, {
        plan: "basic",
        status: "active",
      });

      const { downgradeSubscription } =
        await import("@/lib/services/subscription");

      await downgradeSubscription(subscription.id, "basic");

      const updated = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(updated?.plan).toBe("free_trial");
      expect(updated?.status).toBe("active");
    });

    it("should create subscription event on downgrade", async () => {
      const subscription = await createTestSubscription(testCustomer.id, {
        plan: "pro",
        status: "active",
      });

      const { downgradeSubscription } =
        await import("@/lib/services/subscription");

      await downgradeSubscription(subscription.id, "pro");

      const events = await prisma.subscriptionEvent.findMany({
        where: { subscriptionId: subscription.id },
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("downgraded");
      expect(events[0].fromPlan).toBe("pro");
      expect(events[0].toPlan).toBe("free_trial");
    });
  });

  describe("StripeSubscriptionChecker", () => {
    it("should downgrade when Stripe subscription not found (404)", async () => {
      const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const subscription = await createTestSubscription(testCustomer.id, {
        plan: "basic",
        currentPeriodEnd: pastEnd,
      });

      // Mock Stripe returning resource_missing error (what Stripe actually throws)
      vi.mocked(stripe.subscriptions.retrieve).mockRejectedValue({
        code: "resource_missing",
        type: "invalid_request_error",
      });

      const { StripeSubscriptionChecker } =
        await import("@/lib/services/subscriptionChecker");

      const checker = new StripeSubscriptionChecker();
      const result = await checker.check({
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId!,
        plan: "basic",
      });

      expect(result.action).toBe("downgraded");
      expect(result.reason).toBe("stripe_subscription_not_found");
    });

    it("should renew when Stripe subscription is active", async () => {
      const futureEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await createTestSubscription(testCustomer.id, {
        plan: "basic",
        currentPeriodEnd: futureEnd,
      });

      // Mock Stripe returning active subscription with items data
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
        id: subscription.stripeSubscriptionId,
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(futureEnd.getTime() / 1000),
            },
          ],
        },
      } as any);

      const { StripeSubscriptionChecker } =
        await import("@/lib/services/subscriptionChecker");

      const checker = new StripeSubscriptionChecker();
      const result = await checker.check({
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId!,
        plan: "basic",
      });

      expect(result.action).toBe("renewed");
    });

    it("should downgrade when Stripe subscription is canceled", async () => {
      const subscription = await createTestSubscription(testCustomer.id, {
        plan: "basic",
      });

      // Mock Stripe returning canceled subscription
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
        id: subscription.stripeSubscriptionId,
        status: "canceled",
        cancel_at_period_end: false,
        items: { data: [] },
      } as any);

      const { StripeSubscriptionChecker } =
        await import("@/lib/services/subscriptionChecker");

      const checker = new StripeSubscriptionChecker();
      const result = await checker.check({
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId!,
        plan: "basic",
      });

      expect(result.action).toBe("downgraded");
      expect(result.reason).toBe("stripe_status_canceled");
    });
  });
});
