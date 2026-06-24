"use client";

import moment from "moment";

import { Paragraph } from "@/app/components/Paragraph";
import { Button } from "@/app/components/Button";
import { PlanCard } from "@/app/components/PlanCard";
import { XCircle } from "lucide-react";
import {
  formatPeriodStatus,
  formatBillingPeriod,
  formatExpirationDate,
} from "@/lib/utils/planStatus";
import { SubscriptionPlansProps } from "@/lib/utils/types";
import { getBillingStrategy } from "@/lib/billing/strategies";

import { useState } from "react";

// ─── Billing Type Banner ──────────────────────────────────────────────────────

function BillingTypeBanner({ billingType }: { billingType: string }) {
  const strategy = getBillingStrategy(billingType);
  return (
    <div className="mt-6 rounded-lg border px-4 py-3 text-sm flex items-center gap-2.5 bg-gray-50 border-gray-200 text-gray-600">
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${strategy.banner.indicatorClass}`}
      />
      <span>
        <span className="font-semibold text-gray-800">
          {strategy.banner.label}
        </span>
        {" — "}
        {strategy.banner.description}
      </span>
    </div>
  );
}

// ─── Plan List ────────────────────────────────────────────────────────────────

interface PlanListProps {
  plans: SubscriptionPlansProps["plans"];
  currentPlan: string;
  currentPriceId?: string | null;
  loadingPriceId: string | null;
  onUpgrade: (priceId: string) => void;
}

function PlanList({
  plans,
  currentPlan,
  currentPriceId,
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
          price={getBillingStrategy(plan.billingType).formatPrice(
            plan.price,
            plan.currency,
            plan.interval,
            plan.unitAmount,
          )}
          billingType={plan.billingType}
          current={
            plan.stripePriceId === currentPriceId ||
            plan.planKey === currentPlan
          }
          onUpgrade={() => onUpgrade(plan.stripePriceId)}
          loading={loadingPriceId === plan.stripePriceId}
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
  const planLabel = formatPeriodStatus(
    currentPlan,
    currentPeriodStart,
    currentPeriodEnd,
  );
  const billingPeriod = formatBillingPeriod(
    currentPeriodStart,
    currentPeriodEnd,
  );
  // Don't display when start === end — indicates a stale record not yet updated by the cron
  const isBillingPeriodValid =
    billingPeriod !== null &&
    !moment(currentPeriodStart).isSame(moment(currentPeriodEnd), "day");

  return (
    <div className="mt-10 border-t pt-6">
      <Paragraph className="mb-1">
        <span className="font-semibold">Current Plan:</span> {planLabel}
      </Paragraph>
      {isBillingPeriodValid && (
        <Paragraph className="mb-2 text-sm text-gray-500">
          Billing period: {billingPeriod}
        </Paragraph>
      )}

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
  email,
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
          email,
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

  const firstPlanBillingType = plans[0]?.billingType ?? "flat_rate";
  const showCancelSection = !checkoutSuccess;

  return (
    <>
      {plans.length > 0 && (
        <BillingTypeBanner billingType={firstPlanBillingType} />
      )}

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
