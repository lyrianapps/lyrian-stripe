import { NextRequest, NextResponse } from "next/server";
import {
  ensureBillingSession,
  resolveCheckoutOutcome,
} from "@/lib/checkout/resolveCheckoutOutcome";

/**
 * GET /api/billing/checkout-return
 *
 * Stripe's success_url redirects here after checkout. This is a Route Handler
 * (not a Server Component) so it can reliably set the billing_session cookie
 * before redirecting the user to /subscription.
 *
 * Query params:
 *   session_id   – Stripe checkout session ID
 *   returnUrl    – URL to return to after leaving the billing portal
 *   appId        – App identifier
 *   _test_payment_status / _test_decline_code – E2E test overrides
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("session_id") ?? undefined;
  const returnUrl = searchParams.get("returnUrl") ?? undefined;
  const appId = searchParams.get("appId") ?? undefined;

  const origin = process.env.BILLING_APP_URL ?? req.nextUrl.origin;

  if (sessionId) {
    // Ensure billing_session cookie is set. Route Handlers can set cookies
    // reliably — unlike Server Components, which can only read them.
    await ensureBillingSession(sessionId, appId);

    const testOverrides =
      process.env.ENABLE_E2E_SHORTCUTS === "true"
        ? {
            paymentStatus:
              searchParams.get("_test_payment_status") ?? undefined,
            declineCode: searchParams.get("_test_decline_code") ?? undefined,
          }
        : undefined;

    const outcome = await resolveCheckoutOutcome(
      sessionId,
      appId,
      testOverrides,
    );

    if (outcome.result === "declined") {
      const query = new URLSearchParams({
        checkout_declined: outcome.declineCode,
      });
      if (returnUrl) query.set("returnUrl", returnUrl);
      return NextResponse.redirect(
        `${origin}/subscription?${query.toString()}`,
      );
    }
  }

  const successQuery = new URLSearchParams({ checkout_success: "1" });
  if (returnUrl) successQuery.set("returnUrl", returnUrl);
  return NextResponse.redirect(
    `${origin}/subscription?${successQuery.toString()}`,
  );
}
