import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getStripeForApp } from "@/lib/stripe";
import { getSession } from "@/lib/session";
import { logError } from "@/app/middleware/logger";

/**
 * POST /api/billing/stripe-portal
 *
 * Creates a Stripe Customer Portal session and returns the URL.
 * The portal allows users to:
 * - View and download invoices
 * - Update payment methods
 * - View billing history
 * - Manage subscriptions
 *
 * Request body:
 *   { returnUrl?: string }  - Optional URL to return to after portal session
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("billing_session")?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await getSession(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // Get the billing customer with their Stripe customer ID and app's Stripe key
    const billingCustomer = await prisma.billingCustomer.findUnique({
      where: { id: session.billingCustomerId },
      include: {
        app: {
          select: {
            stripeSecretKey: true,
            stripePortalConfigId: true,
            id: true,
          },
        },
      },
    });

    if (!billingCustomer?.stripeCustomerId) {
      return NextResponse.json(
        {
          error: "No Stripe customer found. Please subscribe to a plan first.",
        },
        { status: 400 },
      );
    }

    // Parse request body for optional returnUrl and flow
    let returnUrl: string | undefined;
    let flow: string | undefined;
    try {
      const body = await req.json();
      returnUrl = body.returnUrl;
      flow = body.flow;
    } catch {
      // No body or invalid JSON is fine
    }

    // Validate flow value to avoid passing arbitrary strings to Stripe
    const validFlows = ["payment_method_update"] as const;
    type ValidFlow = (typeof validFlows)[number];
    const portalFlow: ValidFlow | undefined = validFlows.includes(
      flow as ValidFlow,
    )
      ? (flow as ValidFlow)
      : undefined;

    // Default return URL is the subscription page
    const origin = req.nextUrl.origin;
    const defaultReturnUrl = `${origin}/subscription`;

    const stripeClient = getStripeForApp(billingCustomer.app.stripeSecretKey);

    // Ensure we have a portal configuration that disables the cancel button.
    // Users must cancel through our delete-account flow — we don't want them
    // bypassing it by canceling directly in the Stripe portal. We lazily
    // create this configuration once per app and cache the ID in the DB.
    let portalConfigId: string | null =
      billingCustomer.app.stripePortalConfigId ?? null;
    if (!portalConfigId) {
      const portalConfig =
        await stripeClient.billingPortal.configurations.create({
          features: {
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            // Disable cancel — users must go through our cancel/delete flow.
            subscription_cancel: { enabled: false },
            // We handle upgrade/downgrade natively; keep it off in the portal.
            subscription_update: { enabled: false },
          },
        });
      portalConfigId = portalConfig.id;
      await prisma.app.update({
        where: { id: billingCustomer.app.id },
        data: { stripePortalConfigId: portalConfigId },
      });
    }

    // Create Stripe Customer Portal session.
    // When flow=payment_method_update (e.g. from the PaymentWarningBanner),
    // Stripe opens a focused "replace your default card" screen rather than
    // the general payment-methods list. This prevents the user from
    // accumulating multiple cards and avoids the duplicate-add scenario.
    const portalSession = await stripeClient.billingPortal.sessions.create({
      customer: billingCustomer.stripeCustomerId,
      return_url: returnUrl || defaultReturnUrl,
      configuration: portalConfigId,
      ...(portalFlow && {
        flow_data: { type: portalFlow },
      }),
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    logError(err, "billing/stripe-portal POST");
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 },
    );
  }
}
