"use client";

import { useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { Button } from "./Button";

interface UpdatePaymentMethodButtonProps {
  returnUrl?: string;
  className?: string;
}

/**
 * Button that opens the Stripe Customer Portal in the focused
 * payment_method_update flow so users can proactively update their card.
 * The cancel button is disabled in the portal configuration.
 */
export function UpdatePaymentMethodButton({
  returnUrl,
  className,
}: UpdatePaymentMethodButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/stripe-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl, flow: "payment_method_update" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to open payment method update");
        return;
      }

      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Button
        onClick={handleClick}
        loading={loading}
        variant="outline"
        iconLeft={<CreditCard className="w-4 h-4" />}
        iconRight={<ExternalLink className="w-4 h-4" />}
      >
        Update Payment Method
      </Button>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}
