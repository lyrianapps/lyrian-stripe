import { prisma } from "@/lib/prisma";
import { logger as _logger } from "@/app/middleware/logger";
import {
  createSubscriptionCheckerChain,
  SubscriptionCandidate,
  SubscriptionCheckResult,
} from "@/lib/services/subscriptionChecker";
import { sendSubscriptionEmail } from "@/lib/email";

const logger = _logger.child({ module: "expirationService" });

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
      billingCustomer: {
        select: { app: { select: { stripeSecretKey: true } } },
      },
    },
  });

  return subscriptions.map((s) => ({
    id: s.id,
    stripeSubscriptionId: s.stripeSubscriptionId,
    plan: s.plan as "basic" | "pro",
    appStripeSecretKey: s.billingCustomer.app.stripeSecretKey,
  }));
}

/**
 * Find ALL active paid subscriptions for full Stripe sync
 * This catches deleted/canceled subscriptions regardless of period end date.
 * Includes metered/volume plans — Stripe manages their billing period, but
 * cancellations still need to be synced back to our DB.
 */
export async function findAllActivePaidSubscriptions(): Promise<
  SubscriptionCandidate[]
> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      plan: { in: ["basic", "pro", "paygo", "volume"] },
      status: "active",
    },
    select: {
      id: true,
      stripeSubscriptionId: true,
      plan: true,
      billingCustomer: {
        select: { app: { select: { stripeSecretKey: true } } },
      },
    },
  });

  return subscriptions.map((s) => ({
    id: s.id,
    stripeSubscriptionId: s.stripeSubscriptionId,
    plan: s.plan as "basic" | "pro" | "paygo" | "volume",
    appStripeSecretKey: s.billingCustomer.app.stripeSecretKey,
  }));
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

export type WarningResults = {
  checked: number;
  emailed: number;
  skipped: number;
  errors: number;
};

/**
 * Send renewal warning emails to flat-rate (basic/pro) customers whose
 * subscription ends within the next `daysAhead` days.
 *
 * Safe to run daily — only sends if no warning was sent in the last 6 days
 * (tracked via subscriptionEvent type "renewal_warning_sent").
 */
export async function sendRenewalWarnings(
  daysAhead = 3,
): Promise<WarningResults> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const results: WarningResults = {
    checked: 0,
    emailed: 0,
    skipped: 0,
    errors: 0,
  };

  const subscriptions = await prisma.subscription.findMany({
    where: {
      plan: { in: ["basic", "pro"] },
      status: "active",
      currentPeriodEnd: { gte: now, lte: cutoff },
    },
    select: {
      id: true,
      plan: true,
      currentPeriodEnd: true,
      billingCustomer: {
        select: {
          email: true,
          app: {
            select: {
              name: true,
              resendApiKey: true,
              fromEmail: true,
            },
          },
        },
      },
      // Check if we already sent a warning recently
      events: {
        where: {
          type: "warning_sent",
          createdAt: { gte: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) },
        },
        take: 1,
      },
    },
  });

  for (const sub of subscriptions) {
    results.checked++;

    if (sub.events.length > 0) {
      results.skipped++;
      continue;
    }

    const email = sub.billingCustomer.email;
    if (!email) {
      results.skipped++;
      continue;
    }

    try {
      await sendSubscriptionEmail(
        "subscription_expiring_soon",
        {
          to: email,
          appName: sub.billingCustomer.app.name,
          planName: sub.plan,
          periodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        },
        {
          resendApiKey: sub.billingCustomer.app.resendApiKey,
          fromEmail: sub.billingCustomer.app.fromEmail,
        },
      );

      // Record that we sent the warning so we don't double-send
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          type: "warning_sent",
          fromPlan: sub.plan,
          toPlan: sub.plan,
        },
      });

      results.emailed++;
    } catch (err) {
      logger.warn(
        { err },
        `[cron] Failed to send renewal warning for sub ${sub.id}`,
      );
      results.errors++;
    }
  }

  logger.info(`[cron] Renewal warnings: ${JSON.stringify(results)}`);
  return results;
}

/**
 * Send upcoming bill warnings to metered (paygo/volume) customers whose
 * billing period ends within `daysAhead` days.
 * Includes their current month's unit count as an estimated usage indicator.
 */
export async function sendUsageBillWarnings(
  daysAhead = 3,
): Promise<WarningResults> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const results: WarningResults = {
    checked: 0,
    emailed: 0,
    skipped: 0,
    errors: 0,
  };

  const subscriptions = await prisma.subscription.findMany({
    where: {
      plan: { in: ["paygo", "volume"] },
      status: "active",
      currentPeriodEnd: { gte: now, lte: cutoff },
    },
    select: {
      id: true,
      plan: true,
      currentPeriodEnd: true,
      billingCustomer: {
        select: {
          id: true,
          email: true,
          appId: true,
          app: {
            select: {
              name: true,
              resendApiKey: true,
              fromEmail: true,
            },
          },
        },
      },
      events: {
        where: {
          type: "warning_sent",
          createdAt: { gte: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) },
        },
        take: 1,
      },
    },
  });

  for (const sub of subscriptions) {
    results.checked++;

    if (sub.events.length > 0) {
      results.skipped++;
      continue;
    }

    const email = sub.billingCustomer.email;
    if (!email) {
      results.skipped++;
      continue;
    }

    // Look up current month's usage to estimate the bill
    const usage = await prisma.monthlyUsage.findUnique({
      where: {
        billingCustomerId_yearMonth: {
          billingCustomerId: sub.billingCustomer.id,
          yearMonth,
        },
      },
      select: { unitCount: true },
    });

    // Get unit price from the plan config
    const planConfig = await prisma.appPlan.findFirst({
      where: {
        appId: sub.billingCustomer.appId,
        planKey: sub.plan,
        isActive: true,
      },
      select: { unitAmount: true },
    });

    const estimatedAmount =
      usage && planConfig?.unitAmount
        ? usage.unitCount * planConfig.unitAmount
        : null;

    try {
      await sendSubscriptionEmail(
        "usage_bill_upcoming",
        {
          to: email,
          appName: sub.billingCustomer.app.name,
          planName: sub.plan,
          periodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          estimatedAmount,
        },
        {
          resendApiKey: sub.billingCustomer.app.resendApiKey,
          fromEmail: sub.billingCustomer.app.fromEmail,
        },
      );

      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          type: "warning_sent",
          fromPlan: sub.plan,
          toPlan: sub.plan,
        },
      });

      results.emailed++;
    } catch (err) {
      logger.warn(
        { err },
        `[cron] Failed to send usage bill warning for sub ${sub.id}`,
      );
      results.errors++;
    }
  }

  logger.info(`[cron] Usage bill warnings: ${JSON.stringify(results)}`);
  return results;
}
