import { AppPlan } from "@/lib/utils/types";

// ── Strategy interface ─────────────────────────────────────────────────────────

export interface BillingStrategy {
  /** Canonical billing type identifier */
  readonly billingType: string;
  /** All plan billingType values this strategy handles */
  readonly planTypes: ReadonlyArray<string>;
  /** Format a price for display in the UI */
  formatPrice(
    cents: number,
    currency: string,
    interval: string,
    unitAmount: number | null,
  ): string;
  /** Config for the billing type banner shown above the plan list */
  readonly banner: {
    label: string;
    description: string;
    indicatorClass: string;
  };
}

// ── Concrete strategies ────────────────────────────────────────────────────────

const flatRateStrategy: BillingStrategy = {
  billingType: "flat_rate",
  planTypes: ["flat_rate"],
  formatPrice(cents, currency, interval) {
    const symbol =
      currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
    const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
    return `${symbol}${amount}/${interval}`;
  },
  banner: {
    label: "Subscription billing",
    description:
      "a fixed amount is charged at the start of each billing period.",
    indicatorClass: "bg-blue-500",
  },
};

const meteredStrategy: BillingStrategy = {
  billingType: "metered",
  planTypes: ["metered", "volume"],
  formatPrice(cents, currency, interval, unitAmount) {
    const symbol =
      currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
    if (unitAmount != null) {
      const unit = (unitAmount / 100).toFixed(unitAmount % 100 === 0 ? 0 : 2);
      return `${symbol}${unit}/unit`;
    }
    const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
    return `${symbol}${amount}/${interval}`;
  },
  banner: {
    label: "Usage-based billing",
    description:
      "you're charged per unit at the end of each billing period. No fixed monthly fee.",
    indicatorClass: "bg-emerald-500",
  },
};

// ── Registry ───────────────────────────────────────────────────────────────────

const STRATEGIES: ReadonlyArray<BillingStrategy> = [
  flatRateStrategy,
  meteredStrategy,
];

/**
 * Resolve a strategy from a plan's billingType value.
 * Falls back to flat_rate for unrecognised types.
 */
export function getBillingStrategy(planBillingType: string): BillingStrategy {
  return (
    STRATEGIES.find((s) => s.planTypes.includes(planBillingType)) ??
    flatRateStrategy
  );
}

/**
 * Filter a list of plans to only those handled by the strategy for the given
 * billingType. Returns all plans unfiltered when billingType is undefined
 * (e.g. an unauthenticated context).
 */
export function filterPlansByStrategy(
  plans: AppPlan[],
  billingType: string | undefined,
): AppPlan[] {
  if (!billingType) return plans;
  const strategy = getBillingStrategy(billingType);
  return plans.filter((p) => strategy.planTypes.includes(p.billingType));
}
