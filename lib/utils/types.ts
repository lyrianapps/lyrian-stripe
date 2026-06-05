/**
 * App plan configuration from the billing app
 */
export type AppPlan = {
  planKey: string;
  name: string;
  description: string | null;
  price: number; // in cents
  currency: string;
  interval: string;
  stripePriceId: string;
  billingType: string;
};

/**
 * Props for the SubscriptionPlans component
 */
export type SubscriptionPlansProps = {
  currentPlan: string;
  currentPriceId?: string | null;
  appId: string;
  externalUserId: string;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  cancelAtPeriodEnd?: boolean;
  // Optional return URL provided by the SaaS app via the portal JWT
  returnUrl?: string;
  // Plans configured for this app
  plans: AppPlan[];
};
