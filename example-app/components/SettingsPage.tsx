"use client";

import { useEffect, useState } from "react";

interface SubscriptionStatus {
  plan: string | null;
  status: string | null;
  cancellation?: { scheduledAt: string; message: string };
  error?: string;
}

interface Usage {
  used: number;
  cap: number | null;
  remaining: number | null;
  plan: string;
  billingType: string;
  yearMonth: string;
}

export function SettingsPage() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBillingData() {
      try {
        const [statusData, usageData] = await Promise.all([
          fetch("/api/billing/status").then(
            (r) => r.json() as Promise<SubscriptionStatus>,
          ),
          fetch("/api/billing/usage").then((r) => r.json() as Promise<Usage>),
        ]);
        setStatus(statusData);
        setUsage(usageData);
      } finally {
        setLoading(false);
      }
    }

    loadBillingData().catch(console.error);
  }, []);

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
      {status?.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {status.error}
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
      {!hasSubscription && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Upgrade your plan
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Compare plans and subscribe in the billing portal.
          </p>
          <a
            href="/api/billing/portal-redirect"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Choose a plan →
          </a>
        </section>
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
