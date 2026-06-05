import { redirect } from "next/navigation";
import { getStripeForApp } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const returnUrl = Array.isArray(params?.returnUrl)
    ? params.returnUrl[0]
    : params?.returnUrl;
  const sessionId = Array.isArray(params?.session_id)
    ? params.session_id[0]
    : params?.session_id;

  if (sessionId) {
    // In non-production environments, allow e2e tests to override payment_status
    // and decline_code via query params without needing a real Stripe session.
    const testPaymentStatus =
      process.env.NODE_ENV !== "production"
        ? Array.isArray(params?._test_payment_status)
          ? params._test_payment_status[0]
          : params?._test_payment_status
        : undefined;
    const testDeclineCode =
      process.env.NODE_ENV !== "production"
        ? Array.isArray(params?._test_decline_code)
          ? params._test_decline_code[0]
          : params?._test_decline_code
        : undefined;

    let paymentStatus: string | null = testPaymentStatus ?? null;
    // Default to the generic code; overridden below from Stripe or test param.
    let declineCode = testDeclineCode ?? "declined";

    if (!testPaymentStatus) {
      try {
        const appId = Array.isArray(params?.appId)
          ? params.appId[0]
          : params?.appId;
        const appStripeKey = appId
          ? ((
              await prisma.app.findUnique({
                where: { id: appId },
                select: { stripeSecretKey: true },
              })
            )?.stripeSecretKey ?? null)
          : null;

        const stripeSession = await getStripeForApp(
          appStripeKey,
        ).checkout.sessions.retrieve(sessionId, {
          expand: ["payment_intent"],
        });
        paymentStatus = stripeSession.payment_status;

        // Extract the specific decline reason from the payment intent so we
        // can show a more actionable message (e.g. "card reported lost").
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
      } catch {
        // If we can't retrieve the session (e.g. wrong key, expired), fall
        // through to the success redirect — the webhook is the source of truth.
      }
    }

    if (paymentStatus === "unpaid") {
      const query = new URLSearchParams({ checkout_declined: declineCode });
      if (returnUrl) query.set("returnUrl", returnUrl);
      redirect(`/subscription?${query.toString()}`);
    }
  }

  // Successful payment — always show the success banner on the subscription page
  // first. If a returnUrl was provided, include it so the "Back" link returns
  // the user to their app after they've seen the confirmation.
  const successQuery = new URLSearchParams({ checkout_success: "1" });
  if (returnUrl) successQuery.set("returnUrl", returnUrl);
  redirect(`/subscription?${successQuery.toString()}`);
}
