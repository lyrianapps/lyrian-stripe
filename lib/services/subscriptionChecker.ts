import Stripe from "stripe";
import { getStripeForApp } from "@/lib/stripe";
import { logger as _logger } from "@/app/middleware/logger";
import {
  downgradeSubscription,
  updateSubscriptionPeriod,
} from "@/lib/services/subscription";

const logger = _logger.child({ module: "subscriptionChecker" });

export type SubscriptionCheckResult = {
  action: "downgraded" | "renewed" | "pending" | "error";
  reason?: string;
};

export interface SubscriptionCandidate {
  id: string;
  stripeSubscriptionId: string;
  plan: "basic" | "pro" | "paygo" | "volume";
  appStripeSecretKey?: string | null;
}

/**
 * Strategy interface for checking subscription status
 */
export interface SubscriptionChecker {
  canHandle(subscription: SubscriptionCandidate): boolean;
  check(subscription: SubscriptionCandidate): Promise<SubscriptionCheckResult>;
}

/**
 * Handler for test subscriptions (no Stripe API call)
 */
export class TestSubscriptionChecker implements SubscriptionChecker {
  canHandle(subscription: SubscriptionCandidate): boolean {
    return (
      subscription.stripeSubscriptionId.startsWith("test_sub_") ||
      subscription.stripeSubscriptionId.startsWith("dev_test_")
    );
  }

  async check(
    subscription: SubscriptionCandidate,
  ): Promise<SubscriptionCheckResult> {
    await downgradeSubscription(subscription.id, subscription.plan);
    return { action: "downgraded", reason: "test_subscription_expired" };
  }
}

/**
 * Handler for real Stripe subscriptions
 */
export class StripeSubscriptionChecker implements SubscriptionChecker {
  canHandle(_subscription: SubscriptionCandidate): boolean {
    return true; // Fallback handler
  }

  async check(
    subscription: SubscriptionCandidate,
  ): Promise<SubscriptionCheckResult> {
    try {
      const stripeSubscription = await getStripeForApp(
        subscription.appStripeSecretKey,
      ).subscriptions.retrieve(subscription.stripeSubscriptionId);

      return await this.handleStripeStatus(subscription, stripeSubscription);
    } catch (error: unknown) {
      // Handle deleted subscription (404 from Stripe)
      if (this.isStripeNotFoundError(error)) {
        logger.info(
          `[stripe] Subscription ${subscription.id} not found in Stripe — downgrading`,
        );
        await downgradeSubscription(subscription.id, subscription.plan);
        return {
          action: "downgraded",
          reason: "stripe_subscription_not_found",
        };
      }

      logger.error(
        { err: error },
        `Failed to check Stripe for subscription ${subscription.id}`,
      );
      return { action: "error", reason: "stripe_api_error" };
    }
  }

  private isStripeNotFoundError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "resource_missing"
    );
  }

  private async handleStripeStatus(
    subscription: SubscriptionCandidate,
    stripeSubscription: Stripe.Subscription,
  ): Promise<SubscriptionCheckResult> {
    const { status } = stripeSubscription;

    if (this.isExpiredStatus(status)) {
      await downgradeSubscription(subscription.id, subscription.plan);
      return { action: "downgraded", reason: `stripe_status_${status}` };
    }

    if (this.isActiveStatus(status)) {
      await this.syncPeriodFromStripe(subscription.id, stripeSubscription);
      return { action: "renewed", reason: "stripe_still_active" };
    }

    if (status === "past_due") {
      logger.info(
        `[stripe] Subscription ${subscription.id} is past_due — waiting for retry`,
      );
      return { action: "pending", reason: "stripe_past_due" };
    }

    return { action: "pending", reason: `stripe_status_${status}` };
  }

  private isExpiredStatus(status: string): boolean {
    return ["canceled", "unpaid", "incomplete_expired"].includes(status);
  }

  private isActiveStatus(status: string): boolean {
    return ["active", "trialing"].includes(status);
  }

  private async syncPeriodFromStripe(
    subscriptionId: string,
    stripeSubscription: Stripe.Subscription,
  ) {
    const item = stripeSubscription.items.data[0];
    if (!item?.current_period_start || !item?.current_period_end) return;

    await updateSubscriptionPeriod(
      subscriptionId,
      new Date(item.current_period_start * 1000),
      new Date(item.current_period_end * 1000),
      stripeSubscription.cancel_at_period_end,
    );
  }
}

/**
 * Composite checker that delegates to the appropriate handler
 */
export class SubscriptionCheckerChain {
  private checkers: SubscriptionChecker[];

  constructor(checkers: SubscriptionChecker[]) {
    this.checkers = checkers;
  }

  async check(
    subscription: SubscriptionCandidate,
  ): Promise<SubscriptionCheckResult> {
    for (const checker of this.checkers) {
      if (checker.canHandle(subscription)) {
        return checker.check(subscription);
      }
    }
    return { action: "error", reason: "no_handler_found" };
  }
}

/**
 * Factory to create the default checker chain
 */
export function createSubscriptionCheckerChain(): SubscriptionCheckerChain {
  return new SubscriptionCheckerChain([
    new TestSubscriptionChecker(),
    new StripeSubscriptionChecker(),
  ]);
}
