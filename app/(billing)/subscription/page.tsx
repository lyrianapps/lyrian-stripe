import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";

import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import SubscriptionPlans from "@/app/components/SubscriptionPlans";
import { RemainingMinutesClient } from "@/app/components/RemainingMinutesClient";
import { ManageBillingButton } from "@/app/components/ManageBillingButton";

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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

  const subscription = await prisma.subscription.findFirst({
    where: { billingCustomerId: session.billingCustomerId },
  });

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
      <Heading level={1} className="mb-6 flex items-center gap-2">
        <CreditCard className="w-7 h-7 text-blue-600" /> Subscription
      </Heading>

      <Paragraph>
        Manage your subscription plan. Upgrade, downgrade, or cancel anytime.
      </Paragraph>

      {/* Show Manage Billing button for users with a Stripe customer */}
      <ManageBillingButton returnUrl={returnUrl} className="mb-6" />

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
        appId={session.appId}
        externalUserId={session.externalUserId}
        {...subscriptionData}
        returnUrl={returnUrl}
      />
    </div>
  );
}
