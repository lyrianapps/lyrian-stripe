"use client";

import { useCallback } from "react";
import { RemainingMinutes } from "@/app/components/RemainingMinutes";
import { downgradeSubscription } from "@/app/actions/downgrade";

interface RemainingMinutesClientProps {
  start?: string | Date | null;
  end?: string | Date | null;
  billingCustomerId?: string | null;
}

export function RemainingMinutesClient({
  start,
  end,
  billingCustomerId,
}: RemainingMinutesClientProps) {
  const handleDowngrade = useCallback(async () => {
    if (!billingCustomerId) return;
    try {
      await downgradeSubscription(billingCustomerId);
      window.location.reload();
    } catch (e) {
      console.error("Failed to downgrade subscription", e);
    }
  }, [billingCustomerId]);

  return (
    <RemainingMinutes start={start} end={end} onExpire={handleDowngrade} />
  );
}
