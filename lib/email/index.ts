import { Resend } from "resend";
import { logger } from "@/app/middleware/logger";
import { env } from "@/env";

// Lazy initialization - only create client when needed
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM_EMAIL = env.FROM_EMAIL || "billing@yourdomain.com";

export type EmailEventType =
  | "subscription_created"
  | "subscription_upgraded"
  | "subscription_downgraded"
  | "subscription_canceled"
  | "payment_failed";

export interface EmailContext {
  to: string;
  customerName?: string;
  appName: string;
  planName: string;
  previousPlanName?: string;
  amount?: number | null;
  currency?: string | null;
}

/**
 * Send subscription-related email notifications
 * Fails silently if RESEND_API_KEY is not configured
 */
export async function sendSubscriptionEmail(
  eventType: EmailEventType,
  context: EmailContext,
): Promise<boolean> {
  const client = getResendClient();

  if (!client) {
    logger.info("[email] RESEND_API_KEY not configured, skipping email");
    return false;
  }

  if (!context.to) {
    logger.warn("[email] No recipient email provided, skipping");
    return false;
  }

  const { subject, html } = getEmailContent(eventType, context);

  try {
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to: context.to,
      subject,
      html,
    });

    if (result.error) {
      logger.error(
        `[email] Failed to send ${eventType} email: ${result.error.message}`,
      );
      return false;
    }

    logger.info(`[email] Sent ${eventType} email to ${context.to}`);
    return true;
  } catch (error) {
    logger.error(`[email] Error sending ${eventType} email:`, error);
    return false;
  }
}

/**
 * Preview email content without sending (for testing)
 */
export function previewEmail(
  eventType: EmailEventType,
  context: EmailContext,
): { subject: string; html: string } {
  return getEmailContent(eventType, context);
}

function getEmailContent(
  eventType: EmailEventType,
  context: EmailContext,
): { subject: string; html: string } {
  const {
    customerName,
    appName,
    planName,
    previousPlanName,
    amount,
    currency,
  } = context;
  const name = customerName || "there";
  const formattedAmount = amount
    ? `${(amount / 100).toFixed(2)} ${currency?.toUpperCase() || "USD"}`
    : "";

  switch (eventType) {
    case "subscription_created":
      return {
        subject: `Welcome to ${appName} - ${planName} Plan`,
        html: `
          <h1>Welcome to ${appName}!</h1>
          <p>Hi ${name},</p>
          <p>Thank you for subscribing to the <strong>${planName}</strong> plan.</p>
          ${amount ? `<p>You will be charged <strong>${formattedAmount}</strong> per month.</p>` : ""}
          <p>If you have any questions, please don't hesitate to reach out.</p>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };

    case "subscription_upgraded":
      return {
        subject: `You've upgraded to ${planName} - ${appName}`,
        html: `
          <h1>Upgrade Confirmed!</h1>
          <p>Hi ${name},</p>
          <p>Great news! Your subscription has been upgraded from <strong>${previousPlanName}</strong> to <strong>${planName}</strong>.</p>
          ${amount ? `<p>Your new rate is <strong>${formattedAmount}</strong> per month.</p>` : ""}
          <p>You now have access to all the features included in your new plan.</p>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };

    case "subscription_downgraded":
      return {
        subject: `Your plan has been changed - ${appName}`,
        html: `
          <h1>Plan Changed</h1>
          <p>Hi ${name},</p>
          <p>Your subscription has been changed from <strong>${previousPlanName}</strong> to <strong>${planName}</strong>.</p>
          ${amount ? `<p>Your new rate is <strong>${formattedAmount}</strong> per month.</p>` : ""}
          <p>If you have any questions about your plan, please reach out to us.</p>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };

    case "subscription_canceled":
      return {
        subject: `Subscription Canceled - ${appName}`,
        html: `
          <h1>We're sorry to see you go</h1>
          <p>Hi ${name},</p>
          <p>Your <strong>${planName}</strong> subscription has been canceled.</p>
          <p>You'll continue to have access until the end of your current billing period.</p>
          <p>If you change your mind, you can resubscribe at any time.</p>
          <p>We'd love to hear your feedback on how we can improve.</p>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };

    case "payment_failed":
      return {
        subject: `Payment Failed - Action Required - ${appName}`,
        html: `
          <h1>Payment Failed</h1>
          <p>Hi ${name},</p>
          <p>We were unable to process your payment of <strong>${formattedAmount}</strong> for your <strong>${planName}</strong> subscription.</p>
          <p>Please update your payment method to avoid service interruption.</p>
          <p><strong>What happens next:</strong></p>
          <ul>
            <li>We'll retry the payment in a few days</li>
            <li>If payment continues to fail, your subscription may be paused</li>
          </ul>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };

    default:
      return {
        subject: `Subscription Update - ${appName}`,
        html: `
          <p>Hi ${name},</p>
          <p>There has been an update to your subscription.</p>
          <p>Best regards,<br>The ${appName} Team</p>
        `,
      };
  }
}
