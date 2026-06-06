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
import { resolveNoticeBanners } from "@/lib/utils/banners";
import { loadSubscriptionPageData } from "@/lib/subscription/loadSubscriptionPageData";

/** Coerce a string | string[] | undefined searchParam to string | undefined. */
function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("billing_session")?.value;
  if (!sessionToken) redirect("/unauthorized");

  const session = await getSession(sessionToken);
  if (!session) redirect("/unauthorized");

  // ── Search params ─────────────────────────────────────────────────────────
  const p = await Promise.resolve(searchParams ?? {});
  const returnUrl = param(p.returnUrl);
  const checkoutDeclinedCode = param(p.checkout_declined);
  const checkoutSuccess = Boolean(p.checkout_success);
  const billingType = param(p.billingType);

  // ── Data loading ──────────────────────────────────────────────────────────
  const {
    subscription,
    filteredPlans,
    hasFailedPayments,
    duplicateCardDetected,
    isTest,
  } = await loadSubscriptionPageData(session.appId, session.billingCustomerId);

  // ── Derived UI state ──────────────────────────────────────────────────────
  const noticeBanners = resolveNoticeBanners({
    checkoutDeclinedCode,
    checkoutSuccess,
    duplicateCardDetected,
  });

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

      {subscription?.status === "active" && (
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
        currentPeriodStart={subscription?.currentPeriodStart}
        currentPeriodEnd={subscription?.currentPeriodEnd}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd}
        returnUrl={returnUrl}
        plans={filteredPlans}
        checkoutSuccess={checkoutSuccess}
        billingType={billingType}
      />
    </div>
  );
}
