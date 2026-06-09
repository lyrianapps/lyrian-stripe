"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyticsUpgradePrompt({
  currentPlan,
}: {
  currentPlan: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/plans");
      const { plans } = await res.json();
      const proPlan = plans?.find(
        (p: { key: string; priceId: string | null }) => p.key === "pro",
      );
      if (!proPlan?.priceId) return;

      const checkoutRes = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: proPlan.priceId }),
      });
      const { url } = await checkoutRes.json();
      if (url) router.push(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
        <svg
          className="h-7 w-7 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Analytics is a Pro feature
      </h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
        Upgrade to Pro to unlock todo activity charts, completion trends, and
        monthly breakdowns.
      </p>
      {currentPlan === "basic" || currentPlan === "free_trial" ? (
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Redirecting to Stripe…" : "Upgrade to Pro →"}
        </button>
      ) : null}
    </div>
  );
}
