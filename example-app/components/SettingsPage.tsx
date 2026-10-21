"use client";

import { useEffect, useState } from "react";

interface SubscriptionStatus {
  plan: string | null;
  status: string | null;
  cancellation?: { scheduledAt: string; message: string };
}

interface Usage {
  used: number;
  cap: number | null;
  remaining: number | null;
  plan: string;
  billingType: string;
  yearMonth: string;
}

interface PlanOption {
  key: string;
  name: string;
  description: string;
  price: string;
  billingType: string;
  cap: number | null;
  priceId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan card
// ─────────────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  onUpgrade,
  upgrading,
}: {
  plan: PlanOption;
  isCurrent: boolean;
  onUpgrade: (priceId: string) => void;
  upgrading: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border-2 p-5 transition-colors ${
        isCurrent ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-900">{plan.name}</div>
          <div className="mt-0.5 text-sm text-gray-500">{plan.description}</div>
        </div>
        {isCurrent && (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Current
          </span>
        )}
      </div>

      <div className="text-xl font-bold text-gray-900">{plan.price}</div>

      {plan.billingType === "metered" && (
        <p className="text-xs text-gray-400">
          Charged at the end of each billing period based on actual usage.
          Stripe handles the invoice automatically.
        </p>
      )}

      {!isCurrent && plan.priceId ? (
        <button
          onClick={() => onUpgrade(plan.priceId!)}
          disabled={upgrading}
          className="mt-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {upgrading ? "Redirecting to Stripe…" : "Upgrade →"}
        </button>
      ) : isCurrent ? (
        <p className="text-xs font-medium text-blue-600">
          You&apos;re on this plan
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const CHECKOUT_PENDING_KEY = "billing_checkout_pending";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

export function SettingsPage() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgradingPriceId, setUpgradingPriceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    async function loadBillingData() {
      const checkoutPending =
        typeof window !== "undefined" &&
        sessionStorage.getItem(CHECKOUT_PENDING_KEY) === "1";

      if (checkoutPending) {
        sessionStorage.removeItem(CHECKOUT_PENDING_KEY);
      }

      try {
        const [statusData, usageData, plansData] = await Promise.all([
          fetch("/api/billing/status").then(
            (r) => r.json() as Promise<SubscriptionStatus>,
          ),
          fetch("/api/billing/usage").then((r) => r.json() as Promise<Usage>),
          fetch("/api/billing/plans").then(
            (r) => r.json() as Promise<{ plans: PlanOption[] }>,
          ),
        ]);

        setStatus(statusData);
        setUsage(usageData);
        setPlans(plansData.plans ?? []);

        // If the user just returned from checkout but the webhook hasn't
        // fired yet, the plan will still be free_trial. Poll until it updates.
        if (
          checkoutPending &&
          (statusData.plan == null || statusData.plan === "free_trial")
        ) {
          setActivating(true);
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          const interval = setInterval(async () => {
            if (Date.now() >= deadline) {
              clearInterval(interval);
              setActivating(false);
              return;
            }
            try {
              const res = await fetch("/api/billing/status");
              const data: SubscriptionStatus = await res.json();
              if (data.plan && data.plan !== "free_trial") {
                clearInterval(interval);
                setActivating(false);
                // Refresh all data now that the subscription is live
                const [newUsage, newPlans] = await Promise.all([
                  fetch("/api/billing/usage").then(
                    (r) => r.json() as Promise<Usage>,
                  ),
                  fetch("/api/billing/plans").then(
                    (r) => r.json() as Promise<{ plans: PlanOption[] }>,
                  ),
                ]);
                setStatus(data);
                setUsage(newUsage);
                setPlans(newPlans.plans ?? []);
              }
            } catch {
              // ignore transient fetch errors during polling
            }
          }, POLL_INTERVAL_MS);
        }
      } finally {
        setLoading(false);
      }
    }

    loadBillingData().catch(console.error);
  }, []);

  async function handleUpgrade(priceId: string) {
    setUpgradingPriceId(priceId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Failed to start checkout. Please try again.");
        setUpgradingPriceId(null);
        return;
      }
      sessionStorage.setItem(CHECKOUT_PENDING_KEY, "1");
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setUpgradingPriceId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  const currentPlan = status?.plan ?? "free_trial";
  const isMetered =
    usage?.billingType === "metered" || usage?.billingType === "volume";
  const pct = usage?.cap ? Math.min((usage.used / usage.cap) * 100, 100) : 0;
  // Lyrian reports unsubscribed users as free_trial/trialing, so a free trial isn't a paid subscription.
  const hasSubscription =
    status?.plan !== "free_trial" &&
    (status?.status === "active" ||
      status?.status === "past_due" ||
      status?.status === "trialing");
  // Estimated paygo cost at $0.04/todo
  const estimatedCost =
    isMetered && usage ? (usage.used * 0.04).toFixed(2) : null;

  const statusColor =
    status?.status === "active"
      ? "bg-green-100 text-green-800"
      : status?.status === "past_due"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";

  return (
    <div className="space-y-6">
      {activating && (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <svg
            className="animate-spin h-4 w-4 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <span>Confirming your subscription… this may take a moment.</span>
        </div>
      )}

      {/* ── Current plan card ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Current Plan
        </h2>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 capitalize">
            {currentPlan === "paygo"
              ? "Pay As You Go"
              : currentPlan === "volume"
                ? "Volume"
                : currentPlan.replace(/_/g, " ")}
          </span>
          {status?.status && (
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${statusColor}`}
            >
              {status.status.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {usage && (
          <>
            {isMetered ? (
              // Paygo: show unit count + running cost estimate
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-2xl font-bold text-gray-900">
                  {usage.used}
                </span>
                <span className="text-sm text-gray-500">todos this month</span>
                {estimatedCost && (
                  <span className="ml-auto text-sm font-semibold text-violet-700">
                    ~${estimatedCost} so far
                  </span>
                )}
              </div>
            ) : (
              // Subscription: show cap progress
              <>
                <p className="text-sm text-gray-600 mb-2">
                  <span className="font-bold text-gray-900">{usage.used}</span>
                  {usage.cap && (
                    <>
                      {" "}
                      /{" "}
                      <span className="font-bold text-gray-900">
                        {usage.cap}
                      </span>{" "}
                      todos this month
                    </>
                  )}
                </p>
                {usage.cap && (
                  <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        pct >= 100
                          ? "bg-red-500"
                          : pct >= 80
                            ? "bg-amber-400"
                            : "bg-blue-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-gray-400">
              {usage.yearMonth}
              {isMetered && " · invoice sent at period end"}
              {!isMetered &&
                usage.remaining !== null &&
                ` · ${usage.remaining} remaining`}
            </p>
          </>
        )}

        {status?.cancellation && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {status.cancellation.message}
          </div>
        )}
      </section>

      {/* ── Plan options ────────────────────────────────────────────────────────────── */}
      {!hasSubscription && plans.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Available Plans
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                isCurrent={plan.key === currentPlan}
                onUpgrade={handleUpgrade}
                upgrading={upgradingPriceId === plan.priceId}
              />
            ))}
          </div>
        </section>
      )}

      {!hasSubscription && plans.length === 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            No plans available
          </p>
          <p className="text-sm text-amber-700">
            Billing plans haven&apos;t been configured yet. Please check back
            later.
          </p>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Manage billing ────────────────────────────────────────────────────────── */}
      {hasSubscription && (
        <section className="border-t border-gray-200 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Manage Billing
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {isMetered
              ? "View invoices, update your payment method, or cancel via the Stripe Customer Portal."
              : "Update payment method, view invoices, or cancel your subscription via the Stripe Customer Portal."}
          </p>
          <a
            href="/api/billing/portal-redirect"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Open Billing Portal ↗
          </a>
        </section>
      )}
    </div>
  );
}
