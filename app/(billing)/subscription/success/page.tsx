import { redirect } from "next/navigation";
import Link from "next/link";
import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
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

  // Verify the Stripe checkout session to detect declined / blocked cards.
  // Stripe always redirects to success_url even when payment_status is
  // "unpaid" (e.g. lost card, Radar-blocked card). We check server-side so
  // we can show an appropriate error instead of a false success message.
  if (sessionId) {
    // Resolve the app's Stripe key via the session metadata appId
    let paymentStatus: string | null = null;
    try {
      // Use a minimal retrieve — we only need payment_status
      // Fetch the app's Stripe key from the session metadata appId
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

      const stripeSession =
        await getStripeForApp(appStripeKey).checkout.sessions.retrieve(
          sessionId,
        );
      paymentStatus = stripeSession.payment_status;
    } catch {
      // If we can't retrieve the session (e.g. wrong key, expired), fall
      // through to the success view — the webhook is the source of truth.
    }

    if (paymentStatus === "unpaid") {
      return (
        <div className="max-w-xl mx-auto py-24 px-4 text-center">
          <Heading level={1} className="text-red-600 mb-4">
            Payment Failed
          </Heading>
          <Paragraph className="mb-6">
            Your card was declined or flagged. No charge was made and no
            subscription was created. Please go back and try a different card.
          </Paragraph>
          <Link href="/subscription" className="text-blue-600 underline">
            Try a different plan
          </Link>
        </div>
      );
    }
  }

  // Redirect server-side if returnUrl is provided (only on success)
  if (returnUrl) {
    redirect(returnUrl);
  }

  return (
    <div className="max-w-xl mx-auto py-24 px-4 text-center">
      <Heading level={1} className="text-green-600 mb-4">
        Subscription Successful!
      </Heading>
      <Paragraph className="mb-6">
        Thank you for subscribing. Your plan is now active and you can access
        all features.
      </Paragraph>
      <Link href="/subscription" className="text-blue-600 underline">
        Go to Subscription Management
      </Link>
    </div>
  );
}
