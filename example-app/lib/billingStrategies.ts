// ── Strategy interface ─────────────────────────────────────────────────────────

export interface BillingStrategy {
  /** Canonical billing type identifier */
  readonly billingType: string;
  /** All plan billingType values this strategy handles */
  readonly planTypes: ReadonlyArray<string>;
  /** Format a price value for display in the settings UI */
  formatPrice(cents: number, billingType: string): string;
}

// ── Concrete strategies ────────────────────────────────────────────────────────

const flatRateStrategy: BillingStrategy = {
  billingType: "flat_rate",
  planTypes: ["flat_rate"],
  formatPrice(cents) {
    if (cents === 0) return "Free";
    return `$${(cents / 100).toFixed(2)} / mo`;
  },
};

const meteredStrategy: BillingStrategy = {
  billingType: "metered",
  planTypes: ["metered", "volume"],
  formatPrice() {
    return "Usage-based";
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
