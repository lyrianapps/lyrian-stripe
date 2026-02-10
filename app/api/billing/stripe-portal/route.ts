import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
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

    // Get the billing customer with their Stripe customer ID
    const billingCustomer = await prisma.billingCustomer.findUnique({
      where: { id: session.billingCustomerId },
    });

    if (!billingCustomer?.stripeCustomerId) {
      return NextResponse.json(
        {
          error: "No Stripe customer found. Please subscribe to a plan first.",
        },
        { status: 400 },
      );
    }

    // Parse request body for optional returnUrl
    let returnUrl: string | undefined;
    try {
      const body = await req.json();
      returnUrl = body.returnUrl;
    } catch {
      // No body or invalid JSON is fine
    }

    // Default return URL is the subscription page
    const origin = req.nextUrl.origin;
    const defaultReturnUrl = `${origin}/subscription`;

    // Create Stripe Customer Portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: billingCustomer.stripeCustomerId,
      return_url: returnUrl || defaultReturnUrl,
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
