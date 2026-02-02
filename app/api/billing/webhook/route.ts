import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Plan, SubscriptionStatus } from "@/lib/generated/prisma/enums";
import { logger, logError } from "@/app/middleware/logger";
import {
  PipelineContext,
  PipelineStep,
  BillingPeriod,
  SubscriptionItemData,
  CheckoutPipelineData,
  UpdatePipelineData,
  DeletePipelineData,
  WebhookHandler,
} from "./types";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

const PLAN_HIERARCHY: readonly Plan[] = ["free_trial", "basic", "pro"] as const;

// =============================================================================
// PIPELINE INFRASTRUCTURE
// =============================================================================

function createContext<T>(
  event: Stripe.Event,
  initialData: T,
): PipelineContext<T> {
  return {
    event,
    data: initialData,
    continue: true,
    logs: [],
  };
}

function halt<T>(ctx: PipelineContext<T>, reason?: string): PipelineContext<T> {
  if (reason) ctx.logs.push(`[HALT] ${reason}`);
  return { ...ctx, continue: false };
}

function log<T>(ctx: PipelineContext<T>, message: string): PipelineContext<T> {
  ctx.logs.push(message);
  return ctx;
}

async function runPipeline<TIn, TOut>(
  ctx: PipelineContext<TIn>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: PipelineStep<any, any>[],
): Promise<PipelineContext<TOut>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: PipelineContext<any> = ctx;

  for (const step of steps) {
    if (!current.continue) break;
    current = await step(current);
  }

  // Log all accumulated messages using winston logger
  current.logs.forEach((msg) => {
    if (msg.startsWith("[HALT]")) {
      logger.warn(`[webhook] ${msg}`);
    } else {
      logger.info(`[webhook] ${msg}`);
    }
  });

  return current as PipelineContext<TOut>;
}

// =============================================================================
// MAPPERS
// =============================================================================

function mapStripeStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  const statusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "canceled",
    incomplete: "incomplete",
    incomplete_expired: "incomplete",
    paused: "incomplete",
  };
  return statusMap[status] ?? "incomplete";
}

function isPlanUpgrade(fromPlan: Plan, toPlan: Plan): boolean {
  return PLAN_HIERARCHY.indexOf(toPlan) > PLAN_HIERARCHY.indexOf(fromPlan);
}

// =============================================================================
// EXTRACTORS
// =============================================================================

function extractStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string {
  return typeof customer === "string" ? customer : customer.id;
}

function extractInvoiceId(
  invoice: string | Stripe.Invoice | null,
): string | null {
  if (!invoice) return null;
  return typeof invoice === "string" ? invoice : invoice.id;
}

function extractSubscriptionItemData(
  subscription: Stripe.Subscription,
): SubscriptionItemData | null {
  const item = subscription.items.data[0];
  if (!item) return null;

  const priceId = item.price.id;
  const productId =
    typeof item.price.product === "string"
      ? item.price.product
      : item.price.product?.id;

  if (!priceId || !productId) return null;

  return { priceId, productId };
}

function extractCancellationDate(
  subscription: Stripe.Subscription,
): Date | null {
  if (subscription.cancel_at) {
    return new Date(subscription.cancel_at * 1000);
  }
  if (subscription.ended_at) {
    return new Date(subscription.ended_at * 1000);
  }
  return null;
}

// =============================================================================
// DATA ACCESS
// =============================================================================

async function getPlanFromPriceId(priceId: string): Promise<Plan | null> {
  const planConfig = await prisma.planConfig.findUnique({
    where: { stripePriceId: priceId },
  });
  return planConfig?.plan ?? null;
}

async function findSubscriptionByStripeId(stripeSubscriptionId: string) {
  return prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
  });
}

async function fetchBillingPeriodFromInvoice(
  invoiceId: string,
): Promise<BillingPeriod | null> {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const period = invoice.lines.data[0]?.period;

  if (!period) return null;

  return {
    start: new Date(period.start * 1000),
    end: new Date(period.end * 1000),
  };
}

// =============================================================================
// CHECKOUT SESSION COMPLETED PIPELINE
// =============================================================================

const checkoutSteps = {
  validateSession: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { session } = ctx.data;

    if (session.mode !== "subscription" || !session.subscription) {
      return halt(ctx, "Not a subscription checkout");
    }

    return log(ctx, `[checkout] Validating session ${session.id}`);
  },

  extractMetadata: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { session } = ctx.data;
    const { appId, externalUserId, billingCustomerId } = session.metadata ?? {};

    if (!appId || !externalUserId || !billingCustomerId) {
      return halt(ctx, `Missing metadata in session ${session.id}`);
    }

    return {
      ...ctx,
      data: {
        ...ctx.data,
        metadata: { appId, externalUserId, billingCustomerId },
      },
    };
  },

  fetchStripeSubscription: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { session } = ctx.data;

    const stripeSubscription = await stripe.subscriptions.retrieve(
      session.subscription as string,
    );

    return {
      ...ctx,
      data: { ...ctx.data, stripeSubscription },
    };
  },

  extractItemData: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { stripeSubscription } = ctx.data;

    const itemData = extractSubscriptionItemData(stripeSubscription!);
    if (!itemData) {
      return halt(
        ctx,
        `Missing price/product in subscription ${stripeSubscription!.id}`,
      );
    }

    return {
      ...ctx,
      data: { ...ctx.data, itemData },
    };
  },

  resolvePlan: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { itemData } = ctx.data;

    const plan = await getPlanFromPriceId(itemData!.priceId);
    if (!plan) {
      return halt(ctx, `Unknown price ID: ${itemData!.priceId}`);
    }

    return {
      ...ctx,
      data: { ...ctx.data, plan },
    };
  },

  updateCustomerStripeId: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { stripeSubscription, metadata } = ctx.data;

    const stripeCustomerId = extractStripeCustomerId(
      stripeSubscription!.customer,
    );

    await prisma.billingCustomer.update({
      where: { id: metadata!.billingCustomerId },
      data: { stripeCustomerId },
    });

    return {
      ...ctx,
      data: { ...ctx.data, stripeCustomerId },
    };
  },

  fetchBillingPeriod: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { stripeSubscription } = ctx.data;

    const invoiceId = extractInvoiceId(stripeSubscription!.latest_invoice);
    let period: BillingPeriod;

    if (invoiceId) {
      const fetched = await fetchBillingPeriodFromInvoice(invoiceId);
      period = fetched ?? {
        start: new Date(stripeSubscription!.start_date * 1000),
        end: new Date(stripeSubscription!.start_date * 1000),
      };
    } else {
      period = {
        start: new Date(stripeSubscription!.start_date * 1000),
        end: new Date(stripeSubscription!.start_date * 1000),
      };
    }

    return {
      ...ctx,
      data: { ...ctx.data, period },
    };
  },

  persistSubscription: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { stripeSubscription, metadata, itemData, plan, period } = ctx.data;

    await prisma.subscription.upsert({
      where: { stripeSubscriptionId: stripeSubscription!.id },
      update: {
        status: mapStripeStatus(stripeSubscription!.status),
        stripePriceId: itemData!.priceId,
        stripeProductId: itemData!.productId,
        plan: plan!,
        currentPeriodStart: period!.start,
        currentPeriodEnd: period!.end,
        cancelAtPeriodEnd: stripeSubscription!.cancel_at_period_end,
      },
      create: {
        billingCustomerId: metadata!.billingCustomerId,
        stripeSubscriptionId: stripeSubscription!.id,
        stripePriceId: itemData!.priceId,
        stripeProductId: itemData!.productId,
        plan: plan!,
        status: mapStripeStatus(stripeSubscription!.status),
        currentPeriodStart: period!.start,
        currentPeriodEnd: period!.end,
        cancelAtPeriodEnd: stripeSubscription!.cancel_at_period_end,
      },
    });

    return ctx;
  },

  logSubscriptionCreated: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { stripeSubscription, plan } = ctx.data;

    const subscription = await findSubscriptionByStripeId(
      stripeSubscription!.id,
    );
    if (subscription) {
      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          type: "created",
          toPlan: plan!,
        },
      });
    }

    return log(ctx, `[checkout] Subscription created, plan: ${plan}`);
  },
};

async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  await runPipeline(createContext(event, { session }), [
    checkoutSteps.validateSession,
    checkoutSteps.extractMetadata,
    checkoutSteps.fetchStripeSubscription,
    checkoutSteps.extractItemData,
    checkoutSteps.resolvePlan,
    checkoutSteps.updateCustomerStripeId,
    checkoutSteps.fetchBillingPeriod,
    checkoutSteps.persistSubscription,
    checkoutSteps.logSubscriptionCreated,
  ]);
}

// =============================================================================
// SUBSCRIPTION UPDATED PIPELINE
// =============================================================================

const updateSteps = {
  findExisting: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { subscription } = ctx.data;

    const existingSubscription = await findSubscriptionByStripeId(
      subscription.id,
    );
    if (!existingSubscription) {
      return halt(ctx, `Subscription not found in DB: ${subscription.id}`);
    }

    return {
      ...ctx,
      data: { ...ctx.data, existingSubscription },
    };
  },

  extractItemData: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { subscription } = ctx.data;

    const itemData = extractSubscriptionItemData(subscription);
    if (!itemData) {
      return halt(ctx, "Missing item data");
    }

    return {
      ...ctx,
      data: { ...ctx.data, itemData },
    };
  },

  resolvePlan: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { itemData } = ctx.data;

    const plan = await getPlanFromPriceId(itemData!.priceId);
    if (!plan) {
      return halt(ctx, `Unknown price ID: ${itemData!.priceId}`);
    }

    return {
      ...ctx,
      data: { ...ctx.data, plan },
    };
  },

  fetchBillingPeriod: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { subscription } = ctx.data;

    const invoiceId = extractInvoiceId(subscription.latest_invoice);
    const period = invoiceId
      ? await fetchBillingPeriodFromInvoice(invoiceId)
      : null;

    return {
      ...ctx,
      data: { ...ctx.data, period },
    };
  },

  persistUpdate: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { subscription, itemData, plan, period } = ctx.data;

    await prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: mapStripeStatus(subscription.status),
        stripePriceId: itemData!.priceId,
        stripeProductId: itemData!.productId,
        plan: plan!,
        ...(period && {
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
        }),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });

    return ctx;
  },

  logPlanChangeIfNeeded: async (
    ctx: PipelineContext<UpdatePipelineData>,
  ): Promise<PipelineContext<UpdatePipelineData>> => {
    const { existingSubscription, plan } = ctx.data;

    if (existingSubscription!.plan !== plan) {
      const isUpgrade = isPlanUpgrade(existingSubscription!.plan, plan!);

      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: existingSubscription!.id,
          type: isUpgrade ? "upgraded" : "downgraded",
          fromPlan: existingSubscription!.plan,
          toPlan: plan!,
        },
      });

      return log(
        ctx,
        `[update] Plan changed: ${existingSubscription!.plan} → ${plan}`,
      );
    }

    return log(
      ctx,
      `[update] Subscription updated: ${ctx.data.subscription.id}`,
    );
  },
};

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  await runPipeline(createContext(event, { subscription }), [
    updateSteps.findExisting,
    updateSteps.extractItemData,
    updateSteps.resolvePlan,
    updateSteps.fetchBillingPeriod,
    updateSteps.persistUpdate,
    updateSteps.logPlanChangeIfNeeded,
  ]);
}

// =============================================================================
// SUBSCRIPTION DELETED PIPELINE
// =============================================================================

const deleteSteps = {
  findExisting: async (
    ctx: PipelineContext<DeletePipelineData>,
  ): Promise<PipelineContext<DeletePipelineData>> => {
    const { subscription } = ctx.data;

    const existingSubscription = await findSubscriptionByStripeId(
      subscription.id,
    );
    if (!existingSubscription) {
      return halt(ctx, `Subscription not found: ${subscription.id}`);
    }

    return {
      ...ctx,
      data: { ...ctx.data, existingSubscription },
    };
  },

  extractCancellationDate: async (
    ctx: PipelineContext<DeletePipelineData>,
  ): Promise<PipelineContext<DeletePipelineData>> => {
    const { subscription } = ctx.data;
    const accessEndsAt = extractCancellationDate(subscription);

    return {
      ...ctx,
      data: { ...ctx.data, accessEndsAt },
    };
  },

  persistCancellation: async (
    ctx: PipelineContext<DeletePipelineData>,
  ): Promise<PipelineContext<DeletePipelineData>> => {
    const { subscription, accessEndsAt } = ctx.data;

    await prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: "canceled",
        ...(accessEndsAt && { accessEndsAt }),
      },
    });

    return ctx;
  },

  logCancellation: async (
    ctx: PipelineContext<DeletePipelineData>,
  ): Promise<PipelineContext<DeletePipelineData>> => {
    const { existingSubscription } = ctx.data;

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: existingSubscription!.id,
        type: "canceled",
        fromPlan: existingSubscription!.plan,
      },
    });

    return log(
      ctx,
      `[delete] Subscription canceled: ${ctx.data.subscription.id}`,
    );
  },
};

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  await runPipeline(createContext(event, { subscription }), [
    deleteSteps.findExisting,
    deleteSteps.extractCancellationDate,
    deleteSteps.persistCancellation,
    deleteSteps.logCancellation,
  ]);
}

// =============================================================================
// WEBHOOK HANDLER REGISTRY
// =============================================================================

const webhookHandlers: Record<string, WebhookHandler> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "customer.subscription.updated": handleSubscriptionUpdated,
  "customer.subscription.deleted": handleSubscriptionDeleted,
};

// =============================================================================
// IDEMPOTENCY
// =============================================================================

async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { id: eventId },
  });
  return existingEvent?.processedAt !== null;
}

async function recordEventReceived(event: Stripe.Event): Promise<void> {
  await prisma.stripeEvent.upsert({
    where: { id: event.id },
    update: {},
    create: {
      id: event.id,
      type: event.type,
      payload: event.data.object as object,
    },
  });
}

async function markEventProcessed(eventId: string): Promise<void> {
  await prisma.stripeEvent.update({
    where: { id: eventId },
    data: { processedAt: new Date() },
  });
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    logger.warn("[webhook] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logError(err, "webhook/signature-verification");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  logger.info(`[webhook] Received event: ${event.type} (${event.id})`);

  if (await isEventAlreadyProcessed(event.id)) {
    logger.info(`[webhook] Event already processed: ${event.id}`);
    return NextResponse.json({ received: true });
  }

  await recordEventReceived(event);

  try {
    const handler = webhookHandlers[event.type];

    if (handler) {
      logger.info(`[webhook] Processing: ${event.type}`);
      await handler(event);
    } else {
      logger.warn(`[webhook] Unhandled event type: ${event.type}`);
    }

    await markEventProcessed(event.id);
    logger.info(
      `[webhook] Successfully processed: ${event.type} (${event.id})`,
    );
  } catch (err) {
    logError(err, `webhook/${event.type}`);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
