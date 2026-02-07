import Stripe from "stripe";
import { Plan } from "@/lib/generated/prisma/enums";

// =============================================================================
// PIPELINE TYPES
// =============================================================================

export interface PipelineContext<TData = unknown> {
  event: Stripe.Event;
  data: TData;
  continue: boolean;
  logs: string[];
}

export type PipelineStep<TIn, TOut = TIn> = (
  ctx: PipelineContext<TIn>,
) => Promise<PipelineContext<TOut>>;

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface BillingPeriod {
  start: Date;
  end: Date;
}

export interface SubscriptionItemData {
  priceId: string;
  productId: string;
}

// =============================================================================
// CHECKOUT PIPELINE TYPES
// =============================================================================

export interface CheckoutPipelineData {
  session: Stripe.Checkout.Session;
  metadata?: {
    appId: string;
    externalUserId: string;
    billingCustomerId: string;
  };
  stripeSubscription?: Stripe.Subscription;
  itemData?: SubscriptionItemData;
  plan?: Plan;
  stripeCustomerId?: string;
  period?: BillingPeriod;
}

// =============================================================================
// UPDATE PIPELINE TYPES
// =============================================================================

export interface UpdatePipelineData {
  subscription: Stripe.Subscription;
  existingSubscription?: {
    id: string;
    plan: Plan;
  } | null;
  itemData?: SubscriptionItemData;
  plan?: Plan;
  period?: BillingPeriod | null;
}

export interface DeletePipelineData {
  subscription: Stripe.Subscription;
  existingSubscription?: {
    id: string;
    plan: Plan;
  } | null;
  accessEndsAt?: Date | null;
}

export type WebhookHandler = (event: Stripe.Event) => Promise<void>;
