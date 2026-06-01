import { NextRequest, NextResponse } from "next/server";
import { initiateCheckout } from "@/lib/billing";
import { env } from "@/lib/env";
import { getDemoUserId } from "@/lib/demoMode";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "POST /api/billing/checkout" });

/**
 * POST /api/billing/checkout
 * Body: { priceId: "price_xxx" }
 *
 * Proxies to the billing service's checkout endpoint.
 * The billing API key stays on the server; the client only gets back the
 * Stripe-hosted checkout URL to redirect to.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const priceId = (
    (body as Record<string, unknown>)?.priceId as string | undefined
  )?.trim();
  if (!priceId || !priceId.startsWith("price_")) {
    return NextResponse.json(
      { error: "A valid priceId is required" },
      { status: 400 },
    );
  }

  const returnUrl = `${env.APP_URL}/settings`;

  try {
    const userId = await getDemoUserId();
    const checkoutUrl = await initiateCheckout({
      externalUserId: userId,
      priceId,
      returnUrl,
      email: env.TEST_USER_EMAIL,
    });
    log.info({ priceId }, "Checkout session created");
    return NextResponse.json({ url: checkoutUrl });
  } catch (err: unknown) {
    log.error({ err, priceId }, "Failed to create checkout session");
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
