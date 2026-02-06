import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";

import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import SubscriptionPlans from "@/app/components/SubscriptionPlans";

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function SubscriptionPage() {
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

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <Heading level={1} className="mb-6 flex items-center gap-2">
        <CreditCard className="w-7 h-7 text-blue-600" /> Subscription
      </Heading>

      <Paragraph>
        Manage your subscription plan. Upgrade, downgrade, or cancel anytime.
      </Paragraph>

      <SubscriptionPlans
        currentPlan={subscription?.plan ?? "free_trial"}
        appId={session.appId}
        externalUserId={session.externalUserId}
        {...subscriptionData}
      />
    </div>
  );
}
