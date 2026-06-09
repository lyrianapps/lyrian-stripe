import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSubscriptionStatus } from "@/lib/billing";
import { AnalyticsUpgradePrompt } from "@/components/AnalyticsUpgradePrompt";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Analytics is only meaningful for flat_rate billing users
  if (session.billingType !== "flat_rate") redirect("/");

  const subscription = await getSubscriptionStatus({
    externalUserId: session.userId,
  });

  const isPro = subscription.plan === "pro" && subscription.status === "active";

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Analytics</h1>
      <p className="text-sm text-gray-500 mb-8">
        Track your todo activity over time.
      </p>
      {isPro ? (
        <AnalyticsDashboard userId={session.userId} today={today} />
      ) : (
        <AnalyticsUpgradePrompt currentPlan={subscription.plan} />
      )}
    </>
  );
}
