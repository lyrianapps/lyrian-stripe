import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Plan, SubscriptionStatus } from "@/lib/generated/prisma/enums";
import { logger, logError } from "@/app/middleware/logger";
import { env } from "@/env";
import { checkRateLimit } from "@/lib/middleware/rateLimit";
import { sendSubscriptionEmail } from "@/lib/email";
import {
  PipelineContext,
  PipelineStep,
  BillingPeriod,
  SubscriptionItemData,
  CheckoutPipelineData,
  UpdatePipelineData,
  DeletePipelineData,
  InvoicePipelineData,
  WebhookHandler,
} from "./types";

const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

const PLAN_HIERARCHY: readonly Plan[] = ["free_trial", "basic", "pro"] as const;

// =============================================================================
// PIPELINE INFRASTRUCTURE
// =============================================================================

/** Creates initial pipeline context with event data and default continuation state */
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

/** Stops pipeline execution and logs the halt reason */
function halt<T>(ctx: PipelineContext<T>, reason?: string): PipelineContext<T> {
  if (reason) ctx.logs.push(`[HALT] ${reason}`);
  return { ...ctx, continue: false };
}

/** Appends a message to the pipeline's log buffer */
function log<T>(ctx: PipelineContext<T>, message: string): PipelineContext<T> {
  ctx.logs.push(message);
  return ctx;
}

/** Executes pipeline steps sequentially, halting on failure and logging all accumulated messages */
async function runPipeline<TIn, TOut>(
  ctx: PipelineContext<TIn>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: PipelineStep<any, any>[],
): Promise<PipelineContext<TOut>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: PipelineContext<any> = ctx;

  for (let i = 0; i < steps.length; i++) {
    if (!current.continue) {
      logger.warn(`[webhook] Pipeline halted at step ${i}`);
      break;
    }
    logger.info(`[webhook] Running step ${i + 1}/${steps.length}`);
    try {
      current = await steps[i](current);
    } catch (err) {
      logError(err, `pipeline/step-${i}`);
      throw err;
    }
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

/** Converts Stripe subscription status to internal SubscriptionStatus enum */
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

/** Determines if plan change is an upgrade based on hierarchy (free_trial < basic < pro) */
function isPlanUpgrade(fromPlan: Plan, toPlan: Plan): boolean {
  return PLAN_HIERARCHY.indexOf(toPlan) > PLAN_HIERARCHY.indexOf(fromPlan);
}

// =============================================================================
// EXTRACTORS
// =============================================================================

/** Extracts customer ID string from Stripe customer object or ID */
function extractStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string {
  return typeof customer === "string" ? customer : customer.id;
}

/** Extracts invoice ID string from Stripe invoice object or ID */
function extractInvoiceId(
  invoice: string | Stripe.Invoice | null,
): string | null {
  if (!invoice) return null;
  return typeof invoice === "string" ? invoice : invoice.id;
}

/** Extracts price and product IDs from subscription's first line item */
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

/** Returns subscription end date from cancel_at or ended_at timestamps */
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

/** Extracts subscription ID from invoice (handles new parent.subscription_details structure) */
function extractSubscriptionIdFromInvoice(
  invoice: Stripe.Invoice,
): string | null {
  // New Stripe API structure: subscription is under parent.subscription_details
  const subDetails = invoice.parent?.subscription_details;
  if (subDetails?.subscription) {
    return typeof subDetails.subscription === "string"
      ? subDetails.subscription
      : subDetails.subscription.id;
  }
  return null;
}

/** Looks up internal Plan enum from Stripe price ID via PlanConfig table */
async function getPlanFromPriceId(priceId: string): Promise<Plan | null> {
  logger.info(`[data] Looking up plan for price ID: ${priceId}`);
  const planConfig = await prisma.planConfig.findUnique({
    where: { stripePriceId: priceId },
  });
  if (planConfig) {
    logger.info(`[data] Found plan: ${planConfig.plan}`);
  } else {
    logger.warn(`[data] No plan config found for price ID: ${priceId}`);
  }
  return planConfig?.plan ?? null;
}

/** Looks up internal Plan enum from Stripe price ID via AppPlan table (new per-app pricing) */
async function getPlanFromAppPlan(
  appId: string,
  priceId: string,
): Promise<Plan | null> {
  logger.info(
    `[data] Looking up AppPlan for app ${appId}, price ID: ${priceId}`,
  );
  const appPlan = await prisma.appPlan.findFirst({
    where: {
      appId,
      stripePriceId: priceId,
    },
  });
  if (appPlan) {
    // Map planKey to Plan enum - planKey should match Plan enum values
    const plan = appPlan.planKey as Plan;
    if (PLAN_HIERARCHY.includes(plan)) {
      logger.info(`[data] Found AppPlan: ${appPlan.planKey} -> ${plan}`);
      return plan;
    }
    logger.error(
      `[data] AppPlan planKey '${appPlan.planKey}' doesn't match Plan enum. ` +
        `Valid values: ${PLAN_HIERARCHY.join(", ")}. ` +
        `Fix this by running: UPDATE "AppPlan" SET "planKey" = '<correct_value>' WHERE id = '${appPlan.id}'`,
    );
    return null;
  }
  logger.warn(`[data] No AppPlan found for app ${appId}, price ID: ${priceId}`);
  return null;
}

/** Finds local subscription record by Stripe subscription ID, includes appId from billingCustomer */
async function findSubscriptionByStripeId(stripeSubscriptionId: string) {
  logger.info(
    `[data] Finding subscription by Stripe ID: ${stripeSubscriptionId}`,
  );
  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
    include: {
      billingCustomer: {
        select: { appId: true },
      },
    },
  });
  if (subscription) {
    logger.info(
      `[data] Found subscription: ${subscription.id} (status: ${subscription.status}, appId: ${subscription.billingCustomer.appId})`,
    );
    // Flatten appId onto the subscription object for easier access
    return {
      ...subscription,
      appId: subscription.billingCustomer.appId,
    };
  } else {
    logger.info(
      `[data] No subscription found for Stripe ID: ${stripeSubscriptionId}`,
    );
  }
  return null;
}

/** Finds active subscription for a billing customer (excludes canceled) */
async function findActiveSubscriptionForCustomer(billingCustomerId: string) {
  logger.info(
    `[data] Finding active subscription for customer: ${billingCustomerId}`,
  );
  const subscription = await prisma.subscription.findFirst({
    where: {
      billingCustomerId,
      status: { notIn: ["canceled", "incomplete"] },
    },
  });
  if (subscription) {
    logger.info(
      `[data] Found active subscription: ${subscription.id} (plan: ${subscription.plan})`,
    );
  } else {
    logger.info(
      `[data] No active subscription for customer: ${billingCustomerId}`,
    );
  }
  return subscription;
}

/** Fetches all active subscriptions from Stripe for a customer */

/** Fetches billing period (start/end dates) from Stripe invoice line items */
async function fetchBillingPeriodFromInvoice(
  invoiceId: string,
): Promise<BillingPeriod | null> {
  logger.info(`[data] Fetching billing period from invoice: ${invoiceId}`);
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const period = invoice.lines.data[0]?.period;

  if (!period) {
    logger.warn(`[data] No billing period found in invoice: ${invoiceId}`);
    return null;
  }

  logger.info(
    `[data] Billing period: ${new Date(period.start * 1000).toISOString()} - ${new Date(period.end * 1000).toISOString()}`,
  );
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

  checkExistingSubscription: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { session, metadata } = ctx.data;
    const stripeSubId = session.subscription as string;

    // Check if this exact Stripe subscription already exists locally
    const existingByStripeId = await findSubscriptionByStripeId(stripeSubId);
    if (existingByStripeId) {
      return log(
        ctx,
        `[checkout] Subscription ${stripeSubId} already exists locally, will update`,
      );
    }

    // Check if customer already has an active subscription (potential duplicate)
    const existingActive = await findActiveSubscriptionForCustomer(
      metadata!.billingCustomerId,
    );
    if (existingActive) {
      logger.warn(
        `[webhook] Customer ${metadata!.billingCustomerId} already has active subscription ${existingActive.stripeSubscriptionId}`,
      );
      // Continue anyway - upsert will handle it, but log for visibility
    }

    return log(ctx, `[checkout] No existing subscription found, proceeding`);
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
    const { itemData, metadata } = ctx.data;

    // Try AppPlan first (new per-app pricing), fall back to PlanConfig (legacy)
    let plan = await getPlanFromAppPlan(metadata!.appId, itemData!.priceId);
    if (!plan) {
      plan = await getPlanFromPriceId(itemData!.priceId);
    }
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

    await prisma.billingCustomer.upsert({
      where: { id: metadata!.billingCustomerId },
      update: {
        stripeCustomerId,
      },
      create: {
        id: metadata!.billingCustomerId,
        stripeCustomerId,
        appId: metadata!.appId,
        externalUserId: metadata!.externalUserId,
      },
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

  fetchEmailContext: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const { metadata, itemData } = ctx.data;

    // Fetch customer email and app name
    const billingCustomer = await prisma.billingCustomer.findUnique({
      where: { id: metadata!.billingCustomerId },
      select: { email: true },
    });

    const app = await prisma.app.findUnique({
      where: { id: metadata!.appId },
      select: { name: true, resendApiKey: true, fromEmail: true },
    });

    const appPlan = await prisma.appPlan.findFirst({
      where: { appId: metadata!.appId, stripePriceId: itemData!.priceId },
      select: { name: true, price: true, currency: true },
    });

    return {
      ...ctx,
      data: {
        ...ctx.data,
        customerEmail: billingCustomer?.email,
        appName: app?.name || metadata!.appId,
        appResendApiKey: app?.resendApiKey,
        appFromEmail: app?.fromEmail,
        planName: appPlan?.name || ctx.data.plan || "Subscription",
        planAmount: appPlan?.price,
        planCurrency: appPlan?.currency,
      },
    };
  },

  sendWelcomeEmail: async (
    ctx: PipelineContext<CheckoutPipelineData>,
  ): Promise<PipelineContext<CheckoutPipelineData>> => {
    const {
      customerEmail,
      appName,
      appResendApiKey,
      appFromEmail,
      planName,
      planAmount,
      planCurrency,
    } = ctx.data;

    if (customerEmail) {
      await sendSubscriptionEmail(
        "subscription_created",
        {
          to: customerEmail,
          appName: appName || "App",
          planName: planName || "Subscription",
          amount: planAmount,
          currency: planCurrency,
        },
        { resendApiKey: appResendApiKey, fromEmail: appFromEmail },
      );
    }

    return log(
      ctx,
      `[checkout] Welcome email ${customerEmail ? "sent" : "skipped (no email)"}`,
    );
  },
};

/** Handles checkout.session.completed: creates subscription record from checkout session */
async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  await runPipeline(createContext(event, { session }), [
    checkoutSteps.validateSession,
    checkoutSteps.extractMetadata,
    checkoutSteps.checkExistingSubscription,
    checkoutSteps.fetchStripeSubscription,
    checkoutSteps.extractItemData,
    checkoutSteps.resolvePlan,
    checkoutSteps.updateCustomerStripeId,
    checkoutSteps.fetchBillingPeriod,
    checkoutSteps.persistSubscription,
    checkoutSteps.logSubscriptionCreated,
    checkoutSteps.fetchEmailContext,
    checkoutSteps.sendWelcomeEmail,
  ]);
}

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
    const { itemData, existingSubscription } = ctx.data;

    // Try AppPlan first (new per-app pricing), fall back to PlanConfig (legacy)
    let plan = await getPlanFromAppPlan(
      existingSubscription!.appId,
      itemData!.priceId,
    );
    if (!plan) {
      plan = await getPlanFromPriceId(itemData!.priceId);
    }
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

/** Handles customer.subscription.updated: syncs plan changes and billing period */
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

/** Pipeline steps for handling subscription deletion/cancellation */
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

/** Handles customer.subscription.deleted: marks subscription as canceled */
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
// INVOICE PAYMENT FAILED PIPELINE
// =============================================================================

/** Pipeline steps for handling failed invoice payments */
const invoiceFailedSteps = {
  extractCustomerId: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) {
      return halt(ctx, "No customer ID in invoice");
    }

    return log(ctx, `[invoice] Customer ID: ${customerId}`);
  },

  findBillingCustomer: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;

    const billingCustomer = await prisma.billingCustomer.findUnique({
      where: { stripeCustomerId: customerId! },
      select: {
        id: true,
        email: true,
        appId: true,
        externalUserId: true,
      },
    });

    if (!billingCustomer) {
      return halt(
        ctx,
        `No billing customer found for Stripe customer ${customerId}`,
      );
    }

    return {
      ...ctx,
      data: { ...ctx.data, billingCustomer },
    };
  },

  findSubscription: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    const stripeSubId = extractSubscriptionIdFromInvoice(invoice);

    if (!stripeSubId) {
      // One-time payment, no subscription
      return log(ctx, "[invoice] No subscription linked to invoice");
    }

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
      select: { id: true, plan: true },
    });

    return {
      ...ctx,
      data: { ...ctx.data, subscription },
    };
  },

  extractFailureInfo: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    // Get failure details from the payment intent or charge
    let failureCode: string | null = null;
    let failureMessage: string | null = null;

    if (invoice.last_finalization_error) {
      failureCode = invoice.last_finalization_error.code ?? null;
      failureMessage = invoice.last_finalization_error.message ?? null;
    }

    // Attempt count from invoice
    const attemptCount = invoice.attempt_count ?? 1;

    // Next retry from Stripe's dunning settings
    const nextRetryAt = invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000)
      : null;

    return {
      ...ctx,
      data: {
        ...ctx.data,
        failureInfo: {
          code: failureCode,
          message: failureMessage,
          attemptCount,
          nextRetryAt,
        },
      },
    };
  },

  persistPaymentEvent: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice, billingCustomer, failureInfo } = ctx.data;

    const stripeSubId = extractSubscriptionIdFromInvoice(invoice);

    await prisma.paymentEvent.create({
      data: {
        billingCustomerId: billingCustomer!.id,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: stripeSubId ?? null,
        type: "payment_failed",
        amount: invoice.amount_due,
        currency: invoice.currency,
        failureCode: failureInfo?.code,
        failureMessage: failureInfo?.message,
        attemptCount: failureInfo?.attemptCount ?? 1,
        nextRetryAt: failureInfo?.nextRetryAt,
      },
    });

    return log(
      ctx,
      `[invoice] Recorded payment failure for invoice ${invoice.id} (attempt ${failureInfo?.attemptCount})`,
    );
  },

  updateSubscriptionStatus: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { subscription } = ctx.data;

    if (!subscription) {
      return ctx;
    }

    // Update subscription to past_due status
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "past_due" },
    });

    // Log the event
    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: "payment_failed",
        fromPlan: subscription.plan,
        toPlan: subscription.plan,
      },
    });

    return log(
      ctx,
      `[invoice] Updated subscription ${subscription.id} to past_due`,
    );
  },

  logForNotification: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice, billingCustomer, failureInfo } = ctx.data;

    // Log details that could be used for notifications
    // In a real system, you'd send an email or webhook here
    logger.warn(`[invoice] PAYMENT FAILED - Action required`, {
      customerId: billingCustomer?.id,
      email: billingCustomer?.email,
      appId: billingCustomer?.appId,
      externalUserId: billingCustomer?.externalUserId,
      invoiceId: invoice.id,
      amount: invoice.amount_due,
      currency: invoice.currency,
      attemptCount: failureInfo?.attemptCount,
      nextRetryAt: failureInfo?.nextRetryAt?.toISOString(),
      failureCode: failureInfo?.code,
      failureMessage: failureInfo?.message,
    });

    return log(
      ctx,
      `[invoice] Payment failed notification logged for ${billingCustomer?.email}`,
    );
  },
};

/** Handles invoice.payment_failed: records failure and updates subscription status */
async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  await runPipeline(createContext(event, { invoice }), [
    invoiceFailedSteps.extractCustomerId,
    invoiceFailedSteps.findBillingCustomer,
    invoiceFailedSteps.findSubscription,
    invoiceFailedSteps.extractFailureInfo,
    invoiceFailedSteps.persistPaymentEvent,
    invoiceFailedSteps.updateSubscriptionStatus,
    invoiceFailedSteps.logForNotification,
  ]);
}

// =============================================================================
// INVOICE PAYMENT SUCCEEDED PIPELINE
// =============================================================================

/** Pipeline steps for handling successful invoice payments */
const invoiceSucceededSteps = {
  findBillingCustomer: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) {
      return halt(ctx, "No customer ID in invoice");
    }

    const billingCustomer = await prisma.billingCustomer.findUnique({
      where: { stripeCustomerId: customerId },
      select: {
        id: true,
        email: true,
        appId: true,
        externalUserId: true,
      },
    });

    if (!billingCustomer) {
      return halt(ctx, `No billing customer for Stripe customer ${customerId}`);
    }

    return {
      ...ctx,
      data: { ...ctx.data, billingCustomer },
    };
  },

  findSubscription: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice } = ctx.data;

    const stripeSubId = extractSubscriptionIdFromInvoice(invoice);

    if (!stripeSubId) {
      return log(ctx, "[invoice] No subscription linked to invoice");
    }

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
      select: { id: true, plan: true, status: true },
    });

    return {
      ...ctx,
      data: {
        ...ctx.data,
        subscription: subscription as { id: string; plan: Plan } | null,
      },
    };
  },

  persistPaymentEvent: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { invoice, billingCustomer } = ctx.data;

    const stripeSubId = extractSubscriptionIdFromInvoice(invoice);

    await prisma.paymentEvent.create({
      data: {
        billingCustomerId: billingCustomer!.id,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: stripeSubId ?? null,
        type: "payment_succeeded",
        amount: invoice.amount_paid,
        currency: invoice.currency,
      },
    });

    return log(
      ctx,
      `[invoice] Recorded successful payment for invoice ${invoice.id}`,
    );
  },

  reactivateSubscriptionIfNeeded: async (
    ctx: PipelineContext<InvoicePipelineData>,
  ): Promise<PipelineContext<InvoicePipelineData>> => {
    const { subscription } = ctx.data;

    if (!subscription) {
      return ctx;
    }

    // Check if subscription was in past_due status
    const currentSub = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      select: { status: true },
    });

    if (currentSub?.status === "past_due") {
      // Reactivate subscription
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: "active" },
      });

      await prisma.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          type: "payment_succeeded",
          fromPlan: subscription.plan,
          toPlan: subscription.plan,
        },
      });

      return log(
        ctx,
        `[invoice] Reactivated subscription ${subscription.id} from past_due`,
      );
    }

    return log(
      ctx,
      `[invoice] Subscription ${subscription.id} payment confirmed`,
    );
  },
};

/** Handles invoice.payment_succeeded: records success and reactivates past_due subscriptions */
async function handleInvoicePaymentSucceeded(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  // Skip $0 invoices (trials, free plans)
  if (invoice.amount_paid === 0) {
    logger.info(`[invoice] Skipping $0 invoice ${invoice.id}`);
    return;
  }

  await runPipeline(createContext(event, { invoice }), [
    invoiceSucceededSteps.findBillingCustomer,
    invoiceSucceededSteps.findSubscription,
    invoiceSucceededSteps.persistPaymentEvent,
    invoiceSucceededSteps.reactivateSubscriptionIfNeeded,
  ]);
}

// =============================================================================
// WEBHOOK HANDLER REGISTRY
// =============================================================================

const webhookHandlers: Record<string, WebhookHandler> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "customer.subscription.updated": handleSubscriptionUpdated,
  "customer.subscription.deleted": handleSubscriptionDeleted,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "invoice.payment_succeeded": handleInvoicePaymentSucceeded,
};

// =============================================================================
// IDEMPOTENCY
// =============================================================================

/** Checks if event was already processed to prevent duplicate handling */
async function isEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { id: eventId },
  });
  return Boolean(existingEvent?.processedAt);
}

/** Records incoming event in StripeEvent table for idempotency tracking */
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

/** Marks event as processed with timestamp after successful handling */
async function markEventProcessed(eventId: string): Promise<void> {
  await prisma.stripeEvent.update({
    where: { id: eventId },
    data: { processedAt: new Date() },
  });
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

/** Main webhook endpoint: verifies signature, ensures idempotency, routes to handler */
export async function POST(req: NextRequest) {
  // Rate limit check: 100 requests per minute (generous for Stripe retries)
  const rateLimitResult = await checkRateLimit(req, "webhook");
  if (!rateLimitResult.allowed) {
    logger.warn("[webhook] Rate limited");
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rateLimitResult.retryAfter },
      {
        status: 429,
        headers: rateLimitResult.headers,
      },
    );
  }

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
