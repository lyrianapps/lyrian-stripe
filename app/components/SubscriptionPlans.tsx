"use client";
import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { PlanCard } from "@/app/components/PlanCard";
import { XCircle } from "lucide-react";

export default function SubscriptionPlans({
  currentPlan,
}: {
  currentPlan: string;
}) {
  const planStatus = {
    free_trial: "Free Trial (ends in 7 days)",
    basic: "Basic (renews Feb 1, 2026)",
    pro: "Pro (renews Feb 1, 2026)",
  };
  return (
    <>
      <div className="space-y-6 mt-8">
        <PlanCard
          name="Basic"
          description="For individuals and small teams."
          price="$10/mo"
          current={currentPlan === "basic"}
          onUpgrade={() => alert("Upgrade to Basic")}
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
        <Heading level={3} className="mb-2 text-red-600">
          Cancel Subscription
        </Heading>

        <Paragraph className="mb-2">
          <span className="font-semibold">Current Plan:</span>{" "}
          {planStatus[currentPlan as keyof typeof planStatus] || "Unknown"}
        </Paragraph>
        <Paragraph className="mb-4">
          You can cancel your subscription at any time. Your plan will remain
          active until the end of the billing period.
        </Paragraph>
        <Button
          variant="outline"
          iconLeft={<XCircle className="w-4 h-4" />}
          onClick={() => alert("Unsubscribe")}
        >
          Unsubscribe
        </Button>
      </div>
    </>
  );
}
