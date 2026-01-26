import { Heading } from "@/app/components/Heading";
import { Paragraph } from "@/app/components/Paragraph";
import { CreditCard } from "lucide-react";
import SubscriptionPlans from "@/app/components/SubscriptionPlans";

export default function SubscriptionPage() {
  // In a real app, fetch the user's current plan and status here
  const currentPlan = "free_trial"; // or "basic", "pro"

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <Heading level={1} className="mb-6 flex items-center gap-2">
        <CreditCard className="w-7 h-7 text-blue-600" /> Subscription
      </Heading>
      <Paragraph>
        Manage your subscription plan. Upgrade, downgrade, or cancel anytime.
      </Paragraph>
      <SubscriptionPlans currentPlan={currentPlan} />
    </div>
  );
}
