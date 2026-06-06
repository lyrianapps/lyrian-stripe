import { cookies } from "next/headers";
import { getStripeForApp } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckoutOutcome =
  | { result: "success" }
  | { result: "declined"; declineCode: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lookup the per-app Stripe secret key from the database. */
async function getAppStripeKey(
  appId: string | undefined,
): Promise<string | null> {
  if (!appId) return null;
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { stripeSecretKey: true },
  });
  return app?.stripeSecretKey ?? null;
}

/**
 * Retrieve the full Stripe checkout session (with payment_intent expanded).
 * Returns null on any error so callers can fall through to success.
 */
async function retrieveStripeSession(
  sessionId: string,
  appId: string | undefined,
) {
  const stripeKey = await getAppStripeKey(appId);
  try {
    return await getStripeForApp(stripeKey).checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent"] },
    );
  } catch {
    return null;
  }
}

/**
 * Metered subscriptions have no upfront charge — Stripe reports
 * payment_status="unpaid" for a completed session. Treat that as success
 * unless there is an actual payment_intent error (real card decline).
 */
function resolvePaymentStatus(
  stripeSession: NonNullable<Awaited<ReturnType<typeof retrieveStripeSession>>>,
): { paymentStatus: string; declineCode: string } {
  let paymentStatus = stripeSession.payment_status as string;
  let declineCode = "declined";

  if (
    paymentStatus === "unpaid" &&
    stripeSession.status === "complete" &&
    !(
      stripeSession.payment_intent &&
      typeof stripeSession.payment_intent !== "string" &&
      stripeSession.payment_intent.last_payment_error
    )
  ) {
    paymentStatus = "no_payment_required";
  }

  if (
    paymentStatus === "unpaid" &&
    stripeSession.payment_intent &&
    typeof stripeSession.payment_intent !== "string"
  ) {
    const code =
      stripeSession.payment_intent.last_payment_error?.decline_code ??
      stripeSession.payment_intent.last_payment_error?.code;
    if (code) declineCode = code;
  }

  return { paymentStatus, declineCode };
}

/**
 * If the user arrived directly from Stripe (no prior portal-redirect visit),
 * they have no billing_session cookie — or have an expired one. Reconstruct
 * a fresh session from the Stripe session metadata so /subscription can render
 * without redirecting to /unauthorized.
 */
export async function ensureBillingSession(
  sessionId: string,
  appId: string | undefined,
): Promise<void> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get("billing_session")?.value;

  // If a cookie exists, verify it's still valid in the DB before trusting it.
  if (existingToken) {
    const { getSession } = await import("@/lib/session");
    const valid = await getSession(existingToken).catch(() => null);
    if (valid) return; // session is live — nothing to do
  }

  try {
    const stripeKey = await getAppStripeKey(appId);
    const stripeSession =
      await getStripeForApp(stripeKey).checkout.sessions.retrieve(sessionId);

    const metaAppId = stripeSession.metadata?.appId;
    const metaUserId = stripeSession.metadata?.externalUserId;
    if (!metaAppId || !metaUserId) return;

    const sessionToken = await createSession({
      appId: metaAppId,
      externalUserId: metaUserId,
    });

    cookieStore.set("billing_session", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });
  } catch {
    // Best-effort — /subscription will redirect to /unauthorized if it fails.
  }
}

/**
 * Determine whether a checkout resulted in a success or a card decline.
 *
 * In test environments (ENABLE_E2E_SHORTCUTS=true), _test_payment_status and
 * _test_decline_code query params short-circuit the Stripe API call so tests
 * don't need real Stripe sessions.
 */
export async function resolveCheckoutOutcome(
  sessionId: string,
  appId: string | undefined,
  testOverrides?: { paymentStatus?: string; declineCode?: string },
): Promise<CheckoutOutcome> {
  // Test shortcut: skip the Stripe API call entirely.
  if (testOverrides?.paymentStatus) {
    if (testOverrides.paymentStatus === "unpaid") {
      return {
        result: "declined",
        declineCode: testOverrides.declineCode ?? "declined",
      };
    }
    return { result: "success" };
  }

  const stripeSession = await retrieveStripeSession(sessionId, appId);

  // If we can't retrieve the session, fall through to success — the webhook
  // is the source of truth for subscription state.
  if (!stripeSession) return { result: "success" };

  const { paymentStatus, declineCode } = resolvePaymentStatus(stripeSession);

  if (paymentStatus === "unpaid") {
    return { result: "declined", declineCode };
  }

  return { result: "success" };
}
