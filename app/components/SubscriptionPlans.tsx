"use client";

import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { PlanCard } from "@/app/components/PlanCard";
import { XCircle } from "lucide-react";
import { formatPeriodStatus } from "@/lib/utils/planStatus";

import { useState } from "react";

type Props = {
  currentPlan: string;
  appId: string;
  externalUserId: string;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  onCancel?: () => void;
};

export default function SubscriptionPlans({
  currentPlan,
  appId,
  externalUserId,
  currentPeriodStart,
  currentPeriodEnd,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false);
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
        body: JSON.stringify({ appId, externalUserId, plan: "basic" }),
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
        <Paragraph className="mb-4">
          You can cancel your subscription at any time. Your plan will remain
          active until the end of the billing period.
        </Paragraph>
        <Button
          variant="outline"
          iconLeft={<XCircle className="w-4 h-4" />}
          onClick={onCancel}
        >
          Cancel Subscription
        </Button>
      </div>
    </>
  );
}
