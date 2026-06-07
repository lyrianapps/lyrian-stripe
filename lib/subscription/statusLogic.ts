import { Plan, SubscriptionStatus } from "@/lib/generated/prisma/enums";

export type SubscriptionRow = {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  accessEndsAt: Date | null;
};

/**
 * Prefer active > past_due > trialing to surface the most meaningful record
 * when multiple subscriptions exist (e.g. a stale free_trial alongside an
 * active paid subscription).
 */
export const STATUS_PRIORITY: SubscriptionStatus[] = [
  "active",
  "past_due",
  "trialing",
];

export function selectBestSubscription(
  subscriptions: SubscriptionRow[],
): SubscriptionRow {
  return subscriptions.slice().sort((a, b) => {
    const ai = STATUS_PRIORITY.indexOf(a.status);
    const bi = STATUS_PRIORITY.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  })[0];
}

/**
 * A subscription is expired when its period end has passed and Stripe hasn't
 * marked it active. For active subs, trust Stripe's status — period end may be
 * stale on records created before the webhook stored items.data[0].current_period_end.
 */
export function isExpired(subscription: SubscriptionRow, now: Date): boolean {
  return (
    subscription.status !== "active" && subscription.currentPeriodEnd < now
  );
}

export function buildCancellationMessage(accessEnd: Date): string {
  return `Your subscription will lose access on ${accessEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`;
}
