import { prisma } from "@/lib/prisma";
import { getStripeForApp } from "@/lib/stripe";
import { logger as _logger } from "@/app/middleware/logger";
import { BillingType } from "@/lib/generated/prisma/enums";

const logger = _logger.child({ module: "usageService" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UsageReportInput {
  appId: string;
  externalUserId: string;
  /** Number of units to report. Defaults to 1. */
  quantity?: number;
  /**
   * Optional idempotency key supplied by the caller.
   * If a report with this key was already processed, the original result is
   * returned without incrementing the counter or firing a Stripe meter event.
   *
   * Recommended format: `${stableId}:${Math.floor(Date.now() / 60_000)}`
   * (bucketed to the minute — same action within 60 s deduplicates naturally).
   */
  idempotencyKey?: string;
}

export interface UsageResult {
  /** Whether the unit was within the plan's limits. */
  allowed: boolean;
  /** Total units used in the current calendar month after this report. */
  used: number;
  /** Hard monthly cap, or null if the plan is unlimited. */
  cap: number | null;
  /** Units remaining before the cap, or null if unlimited. */
  remaining: number | null;
  /** The customer's plan key (e.g. "free_trial", "paygo"). */
  plan: string;
  billingType: BillingType;
  yearMonth: string;
}

export interface UsageQueryInput {
  appId: string;
  externalUserId: string;
  /** "YYYY-MM". Defaults to the current calendar month. */
  yearMonth?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

interface PlanConfig {
  billingType: BillingType;
  unitAmount: number | null;
  freeUnitsPerMonth: number | null;
  stripeMeterEventName: string | null;
}

async function resolvePlanConfig(
  appId: string,
  planKey: string,
): Promise<PlanConfig> {
  const appPlan = await prisma.appPlan.findFirst({
    where: { appId, planKey, isActive: true },
    select: {
      billingType: true,
      unitAmount: true,
      freeUnitsPerMonth: true,
      stripeMeterEventName: true,
    },
  });

  return {
    billingType: appPlan?.billingType ?? "flat_rate",
    unitAmount: appPlan?.unitAmount ?? null,
    freeUnitsPerMonth: appPlan?.freeUnitsPerMonth ?? null,
    stripeMeterEventName: appPlan?.stripeMeterEventName ?? null,
  };
}

async function findActiveSubscription(billingCustomerId: string) {
  return prisma.subscription.findFirst({
    where: {
      billingCustomerId,
      status: { notIn: ["canceled", "incomplete"] },
    },
    select: {
      plan: true,
      billingCustomer: {
        select: {
          stripeCustomerId: true,
          app: { select: { stripeSecretKey: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Report N units of usage for a customer.
 *
 * - Free-plan customers: checked against `freeUnitsPerMonth`. Returns
 *   `allowed: false` (without incrementing) when the cap is reached.
 * - Metered / volume customers: usage is incremented and reported to
 *   Stripe as a usage record so the customer is billed appropriately.
 * - Flat-rate customers: usage is tracked for informational purposes only;
 *   there is no cap and no Stripe usage record.
 *
 * The caller decides what a "unit" represents. This service is agnostic.
 */
export async function reportUsage(
  input: UsageReportInput,
): Promise<UsageResult> {
  const { appId, externalUserId, quantity = 1, idempotencyKey } = input;

  if (quantity < 1 || !Number.isInteger(quantity)) {
    throw new Error("quantity must be a positive integer");
  }

  const yearMonth = currentYearMonth();

  // ── 0. Idempotency check ──────────────────────────────────────────────────
  // If the caller supplied a key we've already seen, replay the original result
  // without touching the counter or Stripe — prevents double-billing on retries.
  if (idempotencyKey) {
    const existing = await prisma.usageIdempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });
    if (existing) {
      logger.info(
        `[usage] Duplicate idempotency key "${idempotencyKey}" — replaying cached result`,
      );
      return JSON.parse(existing.resultJson) as UsageResult;
    }
  }

  // ── 1. Resolve customer ───────────────────────────────────────────────────
  const customer = await prisma.billingCustomer.findUnique({
    where: { appId_externalUserId: { appId, externalUserId } },
    select: { id: true },
  });

  if (!customer) {
    throw new Error(
      `No billing customer found for appId=${appId} externalUserId=${externalUserId}`,
    );
  }

  // ── 2. Resolve active subscription + plan config ──────────────────────────
  const subscription = await findActiveSubscription(customer.id);
  const planKey = subscription?.plan ?? "free_trial";
  const config = await resolvePlanConfig(appId, planKey);

  // ── 3. Free-cap pre-flight check ──────────────────────────────────────────
  if (config.freeUnitsPerMonth !== null) {
    const existing = await prisma.monthlyUsage.findUnique({
      where: {
        billingCustomerId_yearMonth: {
          billingCustomerId: customer.id,
          yearMonth,
        },
      },
      select: { unitCount: true },
    });

    const current = existing?.unitCount ?? 0;
    if (current + quantity > config.freeUnitsPerMonth) {
      logger.info(
        `[usage] Cap exceeded for customer ${customer.id}: ${current}/${config.freeUnitsPerMonth} (requested +${quantity})`,
      );
      return {
        allowed: false,
        used: current,
        cap: config.freeUnitsPerMonth,
        remaining: Math.max(0, config.freeUnitsPerMonth - current),
        plan: planKey,
        billingType: config.billingType,
        yearMonth,
      };
    }
  }

  // ── 4. Increment usage counter ────────────────────────────────────────────
  const updated = await prisma.monthlyUsage.upsert({
    where: {
      billingCustomerId_yearMonth: {
        billingCustomerId: customer.id,
        yearMonth,
      },
    },
    update: { unitCount: { increment: quantity } },
    create: {
      billingCustomerId: customer.id,
      appId,
      yearMonth,
      unitCount: quantity,
    },
    select: { unitCount: true },
  });

  const used = updated.unitCount;

  // ── 5. Report to Stripe Billing Meters for metered / volume plans ──────────
  if (
    (config.billingType === "metered" || config.billingType === "volume") &&
    config.stripeMeterEventName &&
    subscription?.billingCustomer?.stripeCustomerId
  ) {
    const stripeKey =
      subscription.billingCustomer?.app?.stripeSecretKey ?? null;
    const stripeCustomerId = subscription.billingCustomer.stripeCustomerId;
    try {
      await getStripeForApp(stripeKey).billing.meterEvents.create({
        event_name: config.stripeMeterEventName,
        payload: {
          value: String(quantity),
          stripe_customer_id: stripeCustomerId,
        },
      });
      logger.info(
        `[usage] Reported ${quantity} unit(s) to Stripe meter "${config.stripeMeterEventName}" for customer ${stripeCustomerId}`,
      );
    } catch (err) {
      // Log but don't fail — the local counter is the source of truth for
      // enforcement. A background job can reconcile with Stripe if needed.
      logger.warn(
        { err },
        `[usage] Failed to report usage to Stripe meter "${config.stripeMeterEventName}" for customer ${stripeCustomerId}`,
      );
    }
  }

  const cap = config.freeUnitsPerMonth;
  const remaining = cap !== null ? Math.max(0, cap - used) : null;

  logger.info(
    `[usage] customer=${customer.id} plan=${planKey} month=${yearMonth} used=${used}${cap !== null ? `/${cap}` : ""}`,
  );

  const result: UsageResult = {
    allowed: true,
    used,
    cap,
    remaining,
    plan: planKey,
    billingType: config.billingType,
    yearMonth,
  };

  // ── 6. Persist idempotency key so retries replay this result ─────────────
  if (idempotencyKey) {
    await prisma.usageIdempotencyKey.create({
      data: {
        key: idempotencyKey,
        billingCustomerId: customer.id,
        appId,
        resultJson: JSON.stringify(result),
      },
    });
  }

  return result;
}

/**
 * Returns the current usage for a customer without modifying it.
 */
export async function getCurrentUsage(
  input: UsageQueryInput,
): Promise<UsageResult> {
  const { appId, externalUserId, yearMonth = currentYearMonth() } = input;

  const customer = await prisma.billingCustomer.findUnique({
    where: { appId_externalUserId: { appId, externalUserId } },
    select: { id: true },
  });

  if (!customer) {
    throw new Error(
      `No billing customer found for appId=${appId} externalUserId=${externalUserId}`,
    );
  }

  const subscription = await findActiveSubscription(customer.id);
  const planKey = subscription?.plan ?? "free_trial";
  const config = await resolvePlanConfig(appId, planKey);

  const record = await prisma.monthlyUsage.findUnique({
    where: {
      billingCustomerId_yearMonth: {
        billingCustomerId: customer.id,
        yearMonth,
      },
    },
    select: { unitCount: true },
  });

  const used = record?.unitCount ?? 0;
  const cap = config.freeUnitsPerMonth;
  const remaining = cap !== null ? Math.max(0, cap - used) : null;

  return {
    allowed: cap === null || used < cap,
    used,
    cap,
    remaining,
    plan: planKey,
    billingType: config.billingType,
    yearMonth,
  };
}
