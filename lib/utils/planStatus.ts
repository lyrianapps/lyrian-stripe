import moment from "moment";

export type PlanFormatter = (
  start?: Date | string | null,
  end?: Date | string | null,
) => string;

export const planFormatters: Record<string, PlanFormatter> = {
  free_trial: (_, end) => {
    if (end) {
      const daysLeft = moment(end).diff(moment(), "days");
      return `Free Trial (ends in ${daysLeft} day${daysLeft !== 1 ? "s" : ""})`;
    }
    return "Free Trial";
  },
  basic: () => "Basic",
  pro: () => "Pro",
  paygo: () => "Pay As You Go",
  volume: () => "Volume",
};

export function formatPeriodStatus(
  plan: string,
  currentPeriodStart?: Date | string | null,
  currentPeriodEnd?: Date | string | null,
): string {
  const formatter = planFormatters[plan];
  return formatter
    ? formatter(currentPeriodStart, currentPeriodEnd)
    : "Unknown";
}

/**
 * Formats a billing period as "MMM D – MMM D, YYYY" (e.g. "Jun 6 – Jul 6, 2026").
 * Returns null when either date is missing.
 */
export function formatBillingPeriod(
  start?: Date | string | null,
  end?: Date | string | null,
): string | null {
  if (!start || !end) return null;
  return `${moment(start).format("MMM D")} – ${moment(end).format("MMM D, YYYY")}`;
}

/** Formats the expiration date for display */
export function formatExpirationDate(
  date: Date | string | null | undefined,
): string {
  if (!date) return "the end of your billing period";
  return moment(date).format("MMMM D, YYYY");
}
