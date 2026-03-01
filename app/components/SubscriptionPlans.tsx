"use client";

import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { PlanCard } from "@/app/components/PlanCard";
import { XCircle } from "lucide-react";
import {
  formatPeriodStatus,
  formatExpirationDate,
} from "@/lib/utils/planStatus";
import { SubscriptionPlansProps } from "@/lib/utils/types";

import { useState } from "react";

/**
 * Format price from cents to display string
 */
function formatPrice(
  cents: number,
  currency: string,
  interval: string,
): string {
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  const symbol =
    currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
  return `${symbol}${amount}/${interval}`;
}

export default function SubscriptionPlans({
  currentPlan,
  currentPriceId,
  appId,
  externalUserId,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  returnUrl,
  plans,
}: SubscriptionPlansProps) {
  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [isCanceled, setIsCanceled] = useState(cancelAtPeriodEnd ?? false);

  // Handle upgrade/subscribe to a plan
  const handleUpgrade = async (priceId: string) => {
    setLoadingPriceId(priceId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          appId,
          externalUserId,
          priceId,
          returnUrl,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
      }
    } catch (err) {
      alert("Network error");
    } finally {
      setLoadingPriceId(null);
    }
  };

  // Handles canceling subscription
  const handleCancel = async () => {
    if (
      !confirm(
        "Are you sure you want to cancel your subscription? You'll keep access until the end of your billing period.",
      )
    ) {
      return;
    }

    setCanceling(true);
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ appId, externalUserId }),
      });
      const data = await res.json();
      if (res.ok) {
        setIsCanceled(true);
        alert(
          "Subscription canceled. You'll have access until the end of your billing period.",
        );
      } else {
        alert(data.error || "Failed to cancel subscription");
      }
    } catch (err) {
      alert("Network error");
    } finally {
      setCanceling(false);
    }
  };

  // Filter out free plans and current plan from upgrade options
  const upgradePlans = plans.filter(
    (plan) => plan.price > 0 && plan.stripePriceId !== currentPriceId,
  );

  return (
    <>
      <div className="space-y-6 mt-8">
        {plans.length === 0 ? (
          <Paragraph className="text-gray-500">
            No pricing plans have been configured for this app yet.
          </Paragraph>
        ) : (
          plans
            .filter((plan) => plan.price > 0) // Don't show free plans as upgrade options
            .map((plan) => (
              <PlanCard
                key={plan.stripePriceId}
                name={plan.name}
                description={plan.description || ""}
                price={formatPrice(plan.price, plan.currency, plan.interval)}
                current={
                  plan.stripePriceId === currentPriceId ||
                  plan.planKey === currentPlan
                }
                onUpgrade={() => handleUpgrade(plan.stripePriceId)}
                loading={loadingPriceId === plan.stripePriceId}
              />
            ))
        )}
      </div>
      <div className="mt-10 border-t pt-6">
        <Paragraph className="mb-2">
          <span className="font-semibold">Current Plan:</span>{" "}
          {formatPeriodStatus(
            currentPlan,
            currentPeriodStart,
            currentPeriodEnd,
          )}
        </Paragraph>
        {isCanceled ? (
          <Paragraph className="mb-4 text-amber-600">
            Your subscription has been canceled. You&apos;ll have access until{" "}
            <span className="font-semibold">
              {formatExpirationDate(currentPeriodEnd)}
            </span>
            .
          </Paragraph>
        ) : (
          <>
            <Paragraph className="mb-4">
              You can cancel your subscription at any time. Your plan will
              remain active until the end of the billing period.
            </Paragraph>
            <Button
              variant="outline"
              iconLeft={<XCircle className="w-4 h-4" />}
              onClick={handleCancel}
              disabled={
                canceling ||
                currentPlan === "free" ||
                currentPlan === "free_trial"
              }
            >
              {canceling ? "Canceling..." : "Cancel Subscription"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
