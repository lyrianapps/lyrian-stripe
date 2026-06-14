import { prisma } from "@/lib/prisma";
import { logger as _logger } from "@/app/middleware/logger";
import { sendSubscriptionEmail, AppEmailCredentials } from "@/lib/email";

const logger = _logger.child({ module: "subscription" });

export interface DowngradeEmailContext {
  to: string;
  customerName?: string;
  appName: string;
  fromPlanName: string;
  credentials?: AppEmailCredentials;
}

/**
 * Downgrade a subscription to free_trial
 */
export async function downgradeSubscription(
  subscriptionId: string,
  fromPlan: "basic" | "pro" | "paygo" | "volume" = "basic",
  emailContext?: DowngradeEmailContext,
) {
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        plan: "free_trial",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
      },
    }),
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId,
        type: "downgraded",
        fromPlan,
        toPlan: "free_trial",
      },
    }),
  ]);

  logger.info(`[subscription] Downgraded subscription ${subscriptionId}`);

  if (emailContext) {
    await sendSubscriptionEmail(
      "subscription_downgraded",
      {
        to: emailContext.to,
        customerName: emailContext.customerName,
        appName: emailContext.appName,
        planName: "Free Trial",
        previousPlanName: emailContext.fromPlanName,
      },
      emailContext.credentials,
    ).catch((err) =>
      logger.warn({ err }, "[subscription] Failed to send downgrade email"),
    );
  }
}

/**
 * Update subscription period from Stripe data
 */
export async function updateSubscriptionPeriod(
  subscriptionId: string,
  periodStart: Date,
  periodEnd: Date,
  cancelAtPeriodEnd: boolean,
) {
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      status: "active",
      cancelAtPeriodEnd,
    },
  });

  logger.info(
    `[subscription] Updated period for subscription ${subscriptionId}`,
  );
}
