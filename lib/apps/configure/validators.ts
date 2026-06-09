import { BillingType } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PlanInput } from "./schemas";

// ─── Billing mode registry ────────────────────────────────────────────────────
//
// Maps each billing mode to the plan billingTypes it permits.
// Add a new entry here to support additional modes without touching
// the validation logic.

export const ALLOWED_PLAN_TYPES_BY_MODE: Record<string, BillingType[]> = {
  flat_rate: ["flat_rate", "volume"],
  metered: ["metered"],
};

export const BILLING_MODE_LABELS: Record<string, string> = {
  flat_rate: "flat rate",
  metered: "metered (pay-as-you-go)",
};

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Returns the billing mode to enforce for plan validation.
 * Prefers the incoming value; falls back to what's already stored on the app.
 */
export async function resolveEffectiveBillingMode(
  appId: string,
  incoming: "flat_rate" | "metered" | undefined,
): Promise<BillingType | null> {
  if (incoming) return incoming as BillingType;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = await (prisma.app.findUnique as any)({
    where: { id: appId },
    select: { billingMode: true },
  });
  return (app?.billingMode as BillingType) ?? null;
}

/**
 * Validates that every plan's billingType is permitted by the effective mode.
 * Returns an error message string if there are violations, null if valid.
 *
 * Extensible: add new modes to ALLOWED_PLAN_TYPES_BY_MODE to expand coverage.
 */
export function checkPlanBillingModeCompatibility(
  plans: PlanInput[],
  effectiveMode: BillingType,
): string | null {
  const allowedTypes =
    ALLOWED_PLAN_TYPES_BY_MODE[effectiveMode] ??
    ALLOWED_PLAN_TYPES_BY_MODE.flat_rate;

  const violations = plans.filter(
    (p) => !allowedTypes.includes(p.billingType as BillingType),
  );

  if (violations.length === 0) return null;

  const modeLabel = BILLING_MODE_LABELS[effectiveMode] ?? effectiveMode;
  const badKeys = violations
    .map((p) => `${p.planKey} (${p.billingType})`)
    .join(", ");

  return (
    `Billing mode mismatch: this app is configured for ${modeLabel}. ` +
    `The following plans have incompatible billing types: ${badKeys}.`
  );
}
