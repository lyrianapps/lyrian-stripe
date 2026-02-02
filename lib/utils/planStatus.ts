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
  basic: (start, end) => {
    if (start && end) {
      return `Basic (${moment(start).format("MMM D")} - ${moment(end).format("MMM D, YYYY")})`;
    }
    return "Basic";
  },
  pro: (start, end) => {
    if (start && end) {
      return `Pro (${moment(start).format("MMM D")} - ${moment(end).format("MMM D, YYYY")})`;
    }
    return "Pro";
  },
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
