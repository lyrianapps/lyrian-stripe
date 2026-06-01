"use client";

import { useRouter } from "next/navigation";
import type { DemoMode } from "@/lib/demoMode";

export function DemoModeSwitcher({ current }: { current: DemoMode }) {
  const router = useRouter();

  function select(mode: DemoMode) {
    if (mode === current) return;
    document.cookie = `demo_mode=${mode}; path=/; max-age=86400; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-400 mr-1 hidden sm:inline">Demo:</span>
      <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs shadow-sm">
        <button
          onClick={() => select("subscription")}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            current === "subscription"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Subscription
        </button>
        <button
          onClick={() => select("paygo")}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            current === "paygo"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Pay as You Go
        </button>
      </div>
    </div>
  );
}
