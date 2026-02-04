import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { CheckoutRequestSchema } from "@/lib/session/schemas";
import { Plan } from "../../../../lib/generated/prisma/enums";
import { env } from "@/env";
import { withApiKey } from "@/lib/auth/apiKey";

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

async function getPlanConfig(plan: Plan) {
  return prisma.planConfig.findUnique({ where: { plan } });
}

// Small helper for consistent error responses
function errorResponse(message: string, status = 500, details?: unknown) {
  const payload: { error: string; details?: unknown } = { error: message };
  if (details) {
    payload.details = details;
  }
  return NextResponse.json(payload, { status });
}

export const POST = withApiKey(async (req: NextRequest) => {
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

  const { appId, externalUserId, plan, email } = parsed.data;

  await upsertApp(appId);

  // 4. Find or create BillingCustomer
  const customer = await findOrCreateBillingCustomer(
    appId,
    externalUserId,
    email,
  );

  // 5. Fetch plan config
  const planConfig = await getPlanConfig(plan);

  if (!planConfig) {
    return errorResponse("Invalid plan", 400);
  }

  // 6. Create Stripe Checkout Session
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price: planConfig.stripePriceId,
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/subscription/success`,
    cancel_url: `${appUrl}/subscription`,
    metadata: {
      appId,
      externalUserId,
      billingCustomerId: customer.id,
    },
  });

  if (!session.url) {
    throw new Error("Stripe session created without URL");
  }

  return NextResponse.json({ url: session.url });
});
