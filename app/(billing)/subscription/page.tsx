import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditCard, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import SubscriptionPlans from "@/app/components/SubscriptionPlans";
import { RemainingMinutesClient } from "@/app/components/RemainingMinutesClient";
import { UpdatePaymentMethodButton } from "@/app/components/ManageBillingButton";
import { PaymentWarningBanner } from "@/app/components/PaymentWarningBanner";

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AppPlan } from "@/lib/utils/types";

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("billing_session")?.value;

  if (!sessionToken) redirect("/unauthorized");

  const session = await getSession(sessionToken);

  console.log("session", session);

  if (!session) redirect("/unauthorized");

  // Fetch app plans for this user's app
  const appPlans = await prisma.appPlan.findMany({
    where: {
      appId: session.appId,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
    select: {
      planKey: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      interval: true,
      stripePriceId: true,
    },
  });

  const subscription = await prisma.subscription.findFirst({
    where: { billingCustomerId: session.billingCustomerId },
  });

  // Check for recent failed payments (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const failedPayment = subscription
    ? await prisma.paymentEvent.findFirst({
        where: {
          billingCustomerId: subscription.billingCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          type: "payment_failed",
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const hasFailedPayments = Boolean(failedPayment);

  const subscriptionData = {
    currentPeriodStart: subscription?.currentPeriodStart,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd,
  };

  // read optional returnUrl from query string (populated by /api/billing/portal)
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const returnUrl = Array.isArray(resolvedSearchParams.returnUrl)
    ? resolvedSearchParams.returnUrl[0]
    : (resolvedSearchParams.returnUrl as string | undefined);
  const checkoutDeclinedCode = Array.isArray(
    resolvedSearchParams.checkout_declined,
  )
    ? resolvedSearchParams.checkout_declined[0]
    : (resolvedSearchParams.checkout_declined as string | undefined);
  const checkoutSuccess = Boolean(resolvedSearchParams.checkout_success);

  const declineMessages: Record<string, { title: string; body: string }> = {
    lost_card: {
      title: "Card reported lost",
      body: "Your card has been reported as lost. No charge was made and no subscription was created. Please use a different card.",
    },
    stolen_card: {
      title: "Card reported stolen",
      body: "Your card has been reported as stolen. No charge was made and no subscription was created. Please use a different card.",
    },
    fraudulent: {
      title: "Transaction flagged",
      body: "This transaction was flagged as suspicious and was not processed. No charge was made and no subscription was created. Please use a different card or contact your bank.",
    },
  };
  const declineBanner = checkoutDeclinedCode
    ? (declineMessages[checkoutDeclinedCode] ?? {
        title: "Card declined",
        body: "Your card was declined or flagged. No charge was made and no subscription was created. Please try a different card.",
      })
    : null;

  const isDevApp = Boolean(
    session?.appId && String(session.appId).startsWith("dev"),
  );
  const isDevTest = Boolean(
    subscription?.stripeSubscriptionId?.startsWith("dev_test_") ||
    subscription?.stripeProductId === "dev_test_product" ||
    subscription?.stripePriceId === "dev_test_price",
  );

  const isTest = isDevApp || isDevTest;

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      {returnUrl && (
        <Link
          href={returnUrl}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      )}

      <Heading level={1} className="mb-6 flex items-center gap-2">
        <CreditCard className="w-7 h-7 text-blue-600" /> Subscription
      </Heading>

      {declineBanner && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-red-800">
          <div className="font-semibold">{declineBanner.title}</div>
          <p className="text-sm mt-1">{declineBanner.body}</p>
        </div>
      )}

      {checkoutSuccess && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-4 text-green-800">
          <div className="font-semibold">Subscription activated</div>
          <p className="text-sm mt-1">
            Your payment was successful and your subscription is now active.
          </p>
        </div>
      )}

      {hasFailedPayments && <PaymentWarningBanner returnUrl={returnUrl} />}

      <Paragraph>
        Manage your subscription plan. Upgrade, downgrade, or cancel anytime.
      </Paragraph>

      {/* Only show for active subscribers — gives them a way to proactively
          update their card before it expires, without exposing cancel. */}
      {subscription && subscription.status === "active" && (
        <UpdatePaymentMethodButton returnUrl={returnUrl} className="mb-6" />
      )}

      {isTest && (
        <div className="mb-6 rounded-md bg-sky-50 border border-sky-200 p-3 text-sky-800">
          <div className="font-semibold">Test account</div>
          <div className="text-sm">
            <RemainingMinutesClient
              start={subscription?.currentPeriodStart}
              end={subscription?.currentPeriodEnd}
              billingCustomerId={subscription?.billingCustomerId}
            />
          </div>
        </div>
      )}

      <SubscriptionPlans
        currentPlan={subscription?.plan ?? "free_trial"}
        currentPriceId={subscription?.stripePriceId}
        appId={session.appId}
        externalUserId={session.externalUserId}
        {...subscriptionData}
        returnUrl={returnUrl}
        plans={appPlans as AppPlan[]}
      />
    </div>
  );
}
