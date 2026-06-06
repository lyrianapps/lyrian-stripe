import { prisma } from "@/lib/prisma";
import { AppPlan } from "@/lib/utils/types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionPageData = {
  subscription: Awaited<ReturnType<typeof loadSubscription>>;
  filteredPlans: AppPlan[];
  hasFailedPayments: boolean;
  duplicateCardDetected: boolean;
  isTest: boolean;
};

// ─── Individual loaders ───────────────────────────────────────────────────────

async function loadAppPlans(appId: string) {
  return prisma.appPlan.findMany({
    where: { appId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      planKey: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      interval: true,
      stripePriceId: true,
      billingType: true,
      unitAmount: true,
    },
  });
}

async function loadSubscription(billingCustomerId: string) {
  return prisma.subscription.findFirst({
    where: { billingCustomerId },
  });
}

async function loadHasFailedPayments(
  subscription: Awaited<ReturnType<typeof loadSubscription>>,
): Promise<boolean> {
  if (!subscription) return false;
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const event = await prisma.paymentEvent.findFirst({
    where: {
      billingCustomerId: subscription.billingCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      type: "payment_failed",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(event);
}

/**
 * Atomically reads and clears the duplicate-card flag so the banner shows
 * exactly once per detection event.
 */
async function consumeDuplicateCardFlag(
  billingCustomerId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.billingCustomer.findUnique({
      where: { id: billingCustomerId },
      select: { duplicateCardDetected: true },
    });
    const detected = customer?.duplicateCardDetected ?? false;
    if (detected) {
      await tx.billingCustomer.update({
        where: { id: billingCustomerId },
        data: { duplicateCardDetected: false },
      });
    }
    return detected;
  });
}

/**
 * A subscription is marked as a test account when the app ID starts with
 * "dev_" or the subscription uses Stripe test fixtures.
 */
function resolveIsTest(
  appId: string,
  subscription: Awaited<ReturnType<typeof loadSubscription>>,
): boolean {
  if (appId.startsWith("dev")) return true;
  return Boolean(
    subscription?.stripeSubscriptionId?.startsWith("dev_test_") ||
    subscription?.stripeProductId === "dev_test_product" ||
    subscription?.stripePriceId === "dev_test_price",
  );
}

/**
 * Free-trial users can see all plan tiers so they can pick a billing model.
 * Once subscribed, only plans matching their billing type are shown (metered
 * users see metered plans; flat-rate users see flat-rate tiers).
 */
function filterPlansByBillingType(
  plans: Awaited<ReturnType<typeof loadAppPlans>>,
  currentPlanKey: string,
): AppPlan[] {
  const currentBillingType =
    currentPlanKey !== "free_trial"
      ? plans.find((p) => p.planKey === currentPlanKey)?.billingType
      : undefined;

  return (
    currentBillingType
      ? plans.filter((p) => p.billingType === currentBillingType)
      : plans
  ) as AppPlan[];
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function loadSubscriptionPageData(
  appId: string,
  billingCustomerId: string,
): Promise<SubscriptionPageData> {
  const [appPlans, subscription] = await Promise.all([
    loadAppPlans(appId),
    loadSubscription(billingCustomerId),
  ]);

  const [hasFailedPayments, duplicateCardDetected] = await Promise.all([
    loadHasFailedPayments(subscription),
    consumeDuplicateCardFlag(billingCustomerId),
  ]);

  const currentPlanKey = subscription?.plan ?? "free_trial";

  return {
    subscription,
    filteredPlans: filterPlansByBillingType(appPlans, currentPlanKey),
    hasFailedPayments,
    duplicateCardDetected,
    isTest: resolveIsTest(appId, subscription),
  };
}
