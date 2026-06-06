import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditCard, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import { NoticeBanner } from "@/app/components/NoticeBanner";
import SubscriptionPlans from "@/app/components/SubscriptionPlans";
import { RemainingMinutesClient } from "@/app/components/RemainingMinutesClient";
import { UpdatePaymentMethodButton } from "@/app/components/ManageBillingButton";
import { PaymentWarningBanner } from "@/app/components/PaymentWarningBanner";

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resolveNoticeBanners } from "@/lib/utils/banners";
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
      billingType: true,
      unitAmount: true,
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

  // Atomically read-and-clear the duplicate card flag so the banner shows once.
  const duplicateCardDetected = await prisma.$transaction(async (tx) => {
    const customer = await tx.billingCustomer.findUnique({
      where: { id: session.billingCustomerId },
      select: { duplicateCardDetected: true },
    });
    const detected = customer?.duplicateCardDetected ?? false;
    if (detected) {
      await tx.billingCustomer.update({
        where: { id: session.billingCustomerId },
        data: { duplicateCardDetected: false },
      });
    }
    return detected;
  });

  const noticeBanners = resolveNoticeBanners({
    checkoutDeclinedCode,
    checkoutSuccess,
    duplicateCardDetected,
  });

  const isDevApp = Boolean(
    session?.appId && String(session.appId).startsWith("dev"),
  );
  const isDevTest = Boolean(
    subscription?.stripeSubscriptionId?.startsWith("dev_test_") ||
    subscription?.stripeProductId === "dev_test_product" ||
    subscription?.stripePriceId === "dev_test_price",
  );

  const isTest = isDevApp || isDevTest;

  // Only show plans matching the user's current billing model.
  // The user's billing type is determined at sign-up (metered vs flat_rate)
  // and stored on their current plan. A paygo user should only see metered
  // upgrade options; a flat-rate user should only see flat-rate tiers.
  const currentPlanKey = subscription?.plan ?? "free_trial";
  // Only filter by billing type when the user has an active (non-trial) subscription.
  // Free-trial users have no AppPlan record, so we show all plans to let them choose.
  const currentBillingType =
    currentPlanKey !== "free_trial"
      ? appPlans.find((p) => p.planKey === currentPlanKey)?.billingType
      : undefined;
  const filteredPlans = currentBillingType
    ? appPlans.filter((p) => p.billingType === currentBillingType)
    : appPlans;

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

      {noticeBanners.map((banner, i) => (
        <NoticeBanner key={i} {...banner} />
      ))}

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
        plans={filteredPlans as AppPlan[]}
        checkoutSuccess={checkoutSuccess}
      />
    </div>
  );
}
