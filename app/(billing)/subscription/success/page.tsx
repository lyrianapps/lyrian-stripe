import { redirect } from "next/navigation";
import {
  ensureBillingSession,
  resolveCheckoutOutcome,
} from "@/lib/checkout/resolveCheckoutOutcome";

/** Coerce a string | string[] | undefined searchParam to string | undefined. */
function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sessionId = param(params?.session_id);
  const returnUrl = param(params?.returnUrl);
  const appId = param(params?.appId);

  if (sessionId) {
    // Ensure the user has a billing_session cookie. When they arrive directly
    // from Stripe (no prior portal-redirect visit) the cookie is absent — we
    // recreate it from the Stripe session metadata.
    await ensureBillingSession(sessionId, appId);

    // In test environments, _test_* params short-circuit the Stripe API call.
    const testOverrides =
      process.env.ENABLE_E2E_SHORTCUTS === "true"
        ? {
            paymentStatus: param(params?._test_payment_status),
            declineCode: param(params?._test_decline_code),
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
      redirect(`/subscription?${query.toString()}`);
    }
  }

  const successQuery = new URLSearchParams({ checkout_success: "1" });
  if (returnUrl) successQuery.set("returnUrl", returnUrl);
  redirect(`/subscription?${successQuery.toString()}`);
}
