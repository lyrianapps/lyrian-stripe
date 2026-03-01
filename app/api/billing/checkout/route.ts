import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { CheckoutRequestSchema } from "@/lib/session/schemas";
import { env } from "@/env";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";

async function upsertApp(appId: string) {
  return prisma.app.upsert({
    where: { id: appId },
    update: {},
    create: { id: appId, name: appId },
  });
}

async function findOrCreateBillingCustomer(
  appId: string,
  externalUserId: string,
  email?: string,
) {
  const customer = await prisma.billingCustomer.findUnique({
    where: { appId_externalUserId: { appId, externalUserId } },
  });

  if (!customer) {
    return prisma.billingCustomer.create({
      data: {
        appId,
        externalUserId,
        stripeCustomerId:
          "placeholder_" + Math.random().toString(36).slice(2, 10),
        email,
      },
    });
  }

  if (email && customer.email !== email) {
    return prisma.billingCustomer.update({
      where: { id: customer.id },
      data: { email },
    });
  }

  return customer;
}

/**
 * Validate that the priceId belongs to a configured plan for this app
 */
async function validateAppPlan(appId: string, priceId: string) {
  return prisma.appPlan.findFirst({
    where: {
      appId,
      stripePriceId: priceId,
      isActive: true,
    },
  });
}

// Small helper for consistent error responses
function errorResponse(message: string, status = 500, details?: unknown) {
  const payload: { error: string; details?: unknown } = { error: message };
  if (details) {
    payload.details = details;
  }
  return NextResponse.json(payload, { status });
}

const checkoutHandler = withApiKey(async (req: NextRequest) => {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return errorResponse("Malformed JSON body", 400);
  }

  const parsed = CheckoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid request body", 400, parsed.error.flatten());
  }

  const { appId, externalUserId, priceId, email, returnUrl } = parsed.data;

  await upsertApp(appId);

  // Validate that this priceId is configured for this app
  const appPlan = await validateAppPlan(appId, priceId);
  if (!appPlan) {
    return errorResponse(
      "Invalid priceId for this app. Make sure the plan is configured.",
      400,
    );
  }

  // Find or create BillingCustomer
  const customer = await findOrCreateBillingCustomer(
    appId,
    externalUserId,
    email,
  );

  // Create Stripe Checkout Session
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  // Validate optional returnUrl to avoid open redirect vulnerabilities.
  let validatedReturnUrl: string | undefined;
  if (returnUrl) {
    try {
      const u = new URL(returnUrl);
      if (!["http:", "https:"].includes(u.protocol)) {
        return errorResponse("Invalid returnUrl protocol", 400);
      }
      if (!u.origin) return errorResponse("Invalid returnUrl", 400);
      validatedReturnUrl = returnUrl;
    } catch {
      return errorResponse("Invalid returnUrl", 400);
    }
  }

  const successBase = `${appUrl}/subscription/success`;
  const cancelBase = `${appUrl}/subscription`;

  const successUrl = validatedReturnUrl
    ? `${successBase}?returnUrl=${encodeURIComponent(validatedReturnUrl)}&appId=${encodeURIComponent(appId)}`
    : successBase;

  const cancelUrl = validatedReturnUrl
    ? `${cancelBase}?returnUrl=${encodeURIComponent(validatedReturnUrl)}&appId=${encodeURIComponent(appId)}`
    : cancelBase;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      appId,
      externalUserId,
      billingCustomerId: customer.id,
      planKey: appPlan.planKey,
    },
  });

  if (!session.url) {
    throw new Error("Stripe session created without URL");
  }

  return NextResponse.json({ url: session.url });
});

// Rate limited: 10 requests per minute
export const POST = withRateLimit("checkout", checkoutHandler);
