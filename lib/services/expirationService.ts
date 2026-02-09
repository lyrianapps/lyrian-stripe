import { prisma } from "@/lib/prisma";
import { logger } from "@/app/middleware/logger";
import {
  createSubscriptionCheckerChain,
  SubscriptionCandidate,
  SubscriptionCheckResult,
} from "@/lib/services/subscriptionChecker";

export type DowngradeResults = {
  checked: number;
  downgraded: number;
  renewed: number;
  pending: number;
  errors: number;
};

/**
 * Find all subscriptions that are candidates for expiration check (period ended)
 */
export async function findExpiredCandidates(): Promise<
  SubscriptionCandidate[]
> {
  const now = new Date();

  const subscriptions = await prisma.subscription.findMany({
    where: {
      plan: { in: ["basic", "pro"] },
      currentPeriodEnd: { lt: now },
      status: "active",
    },
    select: {
      id: true,
      stripeSubscriptionId: true,
      plan: true,
    },
  });

  return subscriptions as SubscriptionCandidate[];
}

/**
 * Find ALL active paid subscriptions for full Stripe sync
 * This catches deleted/canceled subscriptions regardless of period end date
 */
export async function findAllActivePaidSubscriptions(): Promise<
  SubscriptionCandidate[]
> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      plan: { in: ["basic", "pro"] },
      status: "active",
    },
    select: {
      id: true,
      stripeSubscriptionId: true,
      plan: true,
    },
  });

  return subscriptions as SubscriptionCandidate[];
}

/**
 * Process all expired subscription candidates (period ended)
 */
export async function processExpiredSubscriptions(): Promise<DowngradeResults> {
  const candidates = await findExpiredCandidates();

  logger.info(
    `[cron] Found ${candidates.length} potentially expired subscriptions`,
  );

  return processSubscriptions(candidates);
}

/**
 * Process ALL active paid subscriptions — full sync with Stripe
 * Use this to catch deleted/canceled subscriptions regardless of period end
 */
export async function syncAllSubscriptionsWithStripe(): Promise<DowngradeResults> {
  const candidates = await findAllActivePaidSubscriptions();

  logger.info(
    `[cron] Syncing ${candidates.length} active paid subscriptions with Stripe`,
  );

  return processSubscriptions(candidates);
}

/**
 * Process a list of subscription candidates
 */
async function processSubscriptions(
  candidates: SubscriptionCandidate[],
): Promise<DowngradeResults> {
  const results: DowngradeResults = {
    checked: 0,
    downgraded: 0,
    renewed: 0,
    pending: 0,
    errors: 0,
  };

  const checker = createSubscriptionCheckerChain();

  for (const subscription of candidates) {
    results.checked++;

    const result = await checker.check(subscription);
    updateResults(results, result);
  }

  logger.info(`[cron] Sync complete: ${JSON.stringify(results)}`);

  return results;
}

function updateResults(
  results: DowngradeResults,
  checkResult: SubscriptionCheckResult,
) {
  switch (checkResult.action) {
    case "downgraded":
      results.downgraded++;
      break;
    case "renewed":
      results.renewed++;
      break;
    case "pending":
      results.pending++;
      break;
    case "error":
      results.errors++;
      break;
  }
}
