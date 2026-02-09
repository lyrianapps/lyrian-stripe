"use client";

import { useEffect, useState } from "react";

interface RemainingMinutesProps {
  start?: string | Date | null;
  end?: string | Date | null;
  onExpire?: () => void;
}

function formatMinutes(minutes: number) {
  if (minutes < 1) return "Test account expired and downgraded.";
  if (minutes === 1) return "1 minute";
  return `${minutes} minutes`;
}

function computeMinutes(end?: string | Date | null) {
  if (!end) return null;
  const endTime = new Date(end).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((endTime - now) / (60 * 1000)));
}

export function RemainingMinutes({
  start,
  end,
  onExpire,
}: RemainingMinutesProps) {
  const [minutes, setMinutes] = useState<number | null>(() =>
    computeMinutes(end),
  );

  useEffect(() => {
    if (!end) return;

    const interval = setInterval(() => {
      setMinutes((prev) => {
        const next = computeMinutes(end);
        if (prev !== null && prev > 0 && next === 0) {
          // Expired
          onExpire?.();
        }
        return next;
      });
    }, 1000 * 30); // update every 30 seconds

    return () => clearInterval(interval);
  }, [end, onExpire]);

  if (minutes === null) return null;

  return <span>{formatMinutes(minutes)} remaining in this period</span>;
}
