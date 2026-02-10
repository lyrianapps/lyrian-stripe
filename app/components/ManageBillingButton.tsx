"use client";

import { useState } from "react";
import { Receipt, ExternalLink } from "lucide-react";
import { Button } from "./Button";

interface ManageBillingButtonProps {
  returnUrl?: string;
  className?: string;
}

/**
 * Button that redirects users to Stripe's Customer Portal
 * where they can view invoices, update payment methods, etc.
 */
export function ManageBillingButton({
  returnUrl,
  className,
}: ManageBillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
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
    } catch (err) {
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
        iconLeft={<Receipt className="w-4 h-4" />}
        iconRight={<ExternalLink className="w-4 h-4" />}
      >
        Manage Billing
      </Button>
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  );
}
