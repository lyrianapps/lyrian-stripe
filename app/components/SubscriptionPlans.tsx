"use client";

import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { PlanCard } from "@/app/components/PlanCard";
import { XCircle } from "lucide-react";
import { formatPeriodStatus } from "@/lib/utils/planStatus";
import { SubscriptionPlansProps } from "@/lib/utils/types";
import moment from "moment";

import { useState } from "react";

/** Formats the expiration date for display */
function formatExpirationDate(date: Date | string | null | undefined): string {
  if (!date) return "the end of your billing period";
  return moment(date).format("MMMM D, YYYY");
}

export default function SubscriptionPlans({
  currentPlan,
  appId,
  externalUserId,
  currentPeriodStart,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  returnUrl,
}: SubscriptionPlansProps) {
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [isCanceled, setIsCanceled] = useState(cancelAtPeriodEnd ?? false);

  // Handles upgrade to Basic plan
  const handleUpgradeToBasic = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include billing_session cookie
        body: JSON.stringify({
          appId,
          externalUserId,
          plan: "basic",
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
      setLoading(false);
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

  return (
    <>
      <div className="space-y-6 mt-8">
        <PlanCard
          name="Basic"
          description="For individuals and small teams."
          price="$10/mo"
          current={currentPlan === "basic"}
          onUpgrade={handleUpgradeToBasic}
          loading={loading}
        />
        <PlanCard
          name="Pro"
          description="For businesses and power users."
          price="$30/mo"
          current={currentPlan === "pro"}
          onUpgrade={() => alert("Upgrade to Pro")}
        />
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
              disabled={canceling || currentPlan === "free_trial"}
            >
              {canceling ? "Canceling..." : "Cancel Subscription"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
