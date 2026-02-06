/**
 * Props for the SubscriptionPlans component
 */
export type SubscriptionPlansProps = {
  currentPlan: string;
  appId: string;
  externalUserId: string;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  cancelAtPeriodEnd?: boolean;
};
