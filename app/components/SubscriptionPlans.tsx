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
  billingType: string,
  unitAmount: number | null,
): string {
  const symbol =
    currency.toUpperCase() === "USD" ? "$" : currency.toUpperCase();
  if (billingType === "metered" && unitAmount != null) {
    const unit = (unitAmount / 100).toFixed(unitAmount % 100 === 0 ? 0 : 2);
    return `${symbol}${unit}/unit`;
  }
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${symbol}${amount}/${interval}`;
}

// ─── Billing Type Banner ──────────────────────────────────────────────────────

function BillingTypeBanner({ isMetered }: { isMetered: boolean }) {
  if (isMetered) {
    return (
      <div className="mt-6 rounded-lg border px-4 py-3 text-sm flex items-center gap-2.5 bg-gray-50 border-gray-200 text-gray-600">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span>
          <span className="font-semibold text-gray-800">
            Usage-based billing
          </span>
          {" — "}you&apos;re charged per unit at the end of each billing period.
          No fixed monthly fee.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border px-4 py-3 text-sm flex items-center gap-2.5 bg-gray-50 border-gray-200 text-gray-600">
      <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />
      <span>
        <span className="font-semibold text-gray-800">
          Subscription billing
        </span>
        {" — "}a fixed amount is charged at the start of each billing period.
      </span>
    </div>
  );
}

// ─── Plan List ────────────────────────────────────────────────────────────────

interface PlanListProps {
  plans: SubscriptionPlansProps["plans"];
  currentPlan: string;
  currentPriceId?: string | null;
  checkoutSuccess?: boolean;
  loadingPriceId: string | null;
  onUpgrade: (priceId: string) => void;
}

function PlanList({
  plans,
  currentPlan,
  currentPriceId,
  checkoutSuccess,
  loadingPriceId,
  onUpgrade,
}: PlanListProps) {
  const visiblePlans = plans.filter((p) => p.planKey !== "free_trial");

  if (visiblePlans.length === 0) {
    return (
      <Paragraph className="text-gray-500">
        No pricing plans have been configured for this app yet.
      </Paragraph>
    );
  }

  return (
    <>
      {visiblePlans.map((plan) => (
        <PlanCard
          key={plan.stripePriceId}
          name={plan.name}
          description={plan.description || ""}
          price={formatPrice(
            plan.price,
            plan.currency,
            plan.interval,
            plan.billingType,
            plan.unitAmount,
          )}
          billingType={plan.billingType}
          current={
            plan.stripePriceId === currentPriceId ||
            plan.planKey === currentPlan
          }
          onUpgrade={() => onUpgrade(plan.stripePriceId)}
          loading={loadingPriceId === plan.stripePriceId}
          upgradeDisabled={checkoutSuccess}
        />
      ))}
    </>
  );
}

// ─── Cancel Section ───────────────────────────────────────────────────────────

interface CancelSectionProps {
  currentPlan: string;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  isCanceled: boolean;
  canceling: boolean;
  onCancel: () => void;
}

function CancelSection({
  currentPlan,
  currentPeriodStart,
  currentPeriodEnd,
  isCanceled,
  canceling,
  onCancel,
}: CancelSectionProps) {
  const canCancel = currentPlan !== "free" && currentPlan !== "free_trial";
  const periodLabel = formatPeriodStatus(
    currentPlan,
    currentPeriodStart,
    currentPeriodEnd,
  );

  return (
    <div className="mt-10 border-t pt-6">
      <Paragraph className="mb-2">
        <span className="font-semibold">Current Plan:</span> {periodLabel}
      </Paragraph>

      {isCanceled && (
        <Paragraph className="mb-4 text-amber-600">
          Your subscription has been canceled. You&apos;ll have access until{" "}
          <span className="font-semibold">
            {formatExpirationDate(currentPeriodEnd)}
          </span>
          .
        </Paragraph>
      )}

      {!isCanceled && canCancel && (
        <>
          <Paragraph className="mb-4">
            You can cancel your subscription at any time. Your plan will remain
            active until the end of the billing period.
          </Paragraph>
          <Button
            variant="outline"
            iconLeft={<XCircle className="w-4 h-4" />}
            onClick={onCancel}
            disabled={canceling}
          >
            {canceling ? "Canceling..." : "Cancel Subscription"}
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  checkoutSuccess,
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
    } catch {
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
    } catch {
      alert("Network error");
    } finally {
      setCanceling(false);
    }
  };

  const isMetered = plans.some((p) => p.billingType === "metered");

  const showCancelSection = !checkoutSuccess;

  return (
    <>
      {plans.length > 0 && <BillingTypeBanner isMetered={isMetered} />}

      <div className="space-y-6 mt-8">
        {checkoutSuccess && (
          <div className="text-sm text-gray-500 italic">
            Your subscription is activating—this may take a moment to reflect.
          </div>
        )}
        <PlanList
          plans={plans}
          currentPlan={currentPlan}
          currentPriceId={currentPriceId}
          checkoutSuccess={checkoutSuccess}
          loadingPriceId={loadingPriceId}
          onUpgrade={handleUpgrade}
        />
      </div>

      {showCancelSection && (
        <CancelSection
          currentPlan={currentPlan}
          currentPeriodStart={currentPeriodStart}
          currentPeriodEnd={currentPeriodEnd}
          isCanceled={isCanceled}
          canceling={canceling}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}
