import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { logger as _logger } from "@/app/middleware/logger";
import { checkRateLimit } from "@/lib/middleware/rateLimit";
import { getStripeForApp, getWebhookSecretForApp } from "@/lib/stripe";

// Re-use all pipeline handlers from the shared webhook module
import {
  webhookHandlers,
  isEventAlreadyProcessed,
  recordEventReceived,
  markEventProcessed,
} from "../route";

const logger = _logger.child({ route: "POST /api/billing/webhook/[appId]" });

/** Per-app webhook endpoint: POST /api/billing/webhook/:appId */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;

  const rateLimitResult = await checkRateLimit(req, "webhook");
  if (!rateLimitResult.allowed) {
    logger.warn("[webhook] Rate limited");
    return NextResponse.json(
      { error: "Too many requests", retryAfter: rateLimitResult.retryAfter },
      { status: 429, headers: rateLimitResult.headers },
    );
  }

  // Look up app's Stripe credentials
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { stripeSecretKey: true, stripeWebhookSecret: true },
  });

  if (!app) {
    logger.warn(`[webhook] Unknown appId: ${appId}`);
    return NextResponse.json({ error: "Unknown app" }, { status: 404 });
  }

  const stripeInstance = getStripeForApp(app.stripeSecretKey);
  const webhookSecret = getWebhookSecretForApp(app.stripeWebhookSecret);

  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    logger.warn("[webhook] Missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripeInstance.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch (err) {
    logger.error({ err }, "webhook/signature-verification");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  logger.info(`[webhook:${appId}] Received event: ${event.type} (${event.id})`);

  if (await isEventAlreadyProcessed(event.id)) {
    logger.info(`[webhook:${appId}] Event already processed: ${event.id}`);
    return NextResponse.json({ received: true });
  }

  await recordEventReceived(event);

  try {
    const handler = webhookHandlers[event.type];

    if (handler) {
      logger.info(`[webhook:${appId}] Processing: ${event.type}`);
      await handler(event);
    } else {
      logger.warn(`[webhook:${appId}] Unhandled event type: ${event.type}`);
    }

    await markEventProcessed(event.id);
    logger.info(
      `[webhook:${appId}] Successfully processed: ${event.type} (${event.id})`,
    );
  } catch (err) {
    logger.error({ err }, `webhook/${appId}/${event.type}`);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
