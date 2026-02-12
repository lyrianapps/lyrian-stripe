"use client";

import { useState } from "react";
import { AlertTriangle, CreditCard, ExternalLink, X } from "lucide-react";
import { Button } from "./Button";

interface PaymentWarningBannerProps {
  returnUrl?: string;
  onDismiss?: () => void;
}

/**
 * Warning banner shown when a user has failed payments.
 * Provides a button to redirect to Stripe Customer Portal
 * where they can update their payment method.
 */
export function PaymentWarningBanner({
  returnUrl,
  onDismiss,
}: PaymentWarningBannerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const handleUpdatePayment = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/stripe-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to open billing portal");
        return;
      }

      // Redirect to Stripe Customer Portal
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (dismissed) {
    return null;
  }

  return (
    <div
      className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4"
      role="alert"
      data-testid="payment-warning-banner"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-red-800">Payment Failed</h3>
          <p className="text-red-700 text-sm mt-1">
            Your last payment failed. Please update your payment method to avoid
            service interruption.
          </p>
          {error && (
            <p className="text-red-600 text-sm mt-2 font-medium">{error}</p>
          )}
          <div className="mt-3">
            <Button
              onClick={handleUpdatePayment}
              loading={loading}
              variant="filled"
              iconLeft={<CreditCard className="w-4 h-4" />}
              iconRight={<ExternalLink className="w-4 h-4" />}
              data-testid="update-payment-button"
            >
              Update Payment Method
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-red-400 hover:text-red-600 transition-colors"
          aria-label="Dismiss"
          data-testid="dismiss-warning-button"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
