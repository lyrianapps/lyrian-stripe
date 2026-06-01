import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * GET /api/billing/plans
 *
 * Proxies to the billing service's GET /api/apps/:appId/plans endpoint.
 * All plan data (names, descriptions, price IDs, billing types) lives in
 * the billing service — no need to duplicate it here as env vars.
 */
export async function GET() {
  try {
    const res = await fetch(
      `${env.BILLING_API_URL}/api/apps/${env.BILLING_APP_ID}/plans`,
      {
        headers: { "x-api-key": env.BILLING_API_KEY },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return NextResponse.json({ plans: [] });
    }

    const data = (await res.json()) as {
      plans: {
        planKey: string;
        name: string;
        description: string | null;
        price: number;
        billingType: string;
        freeUnitsPerMonth: number | null;
        stripePriceId: string | null;
      }[];
    };

    // Shape the response to match what SettingsPage expects
    const plans = data.plans.map((p) => ({
      key: p.planKey,
      name: p.name,
      description: p.description ?? "",
      price:
        p.price === 0
          ? p.billingType === "metered" || p.billingType === "volume"
            ? "Usage-based"
            : "Free"
          : `$${(p.price / 100).toFixed(2)} / mo`,
      billingType: p.billingType,
      cap: p.freeUnitsPerMonth,
      priceId: p.stripePriceId,
    }));

    return NextResponse.json({ plans });
  } catch {
    return NextResponse.json({ plans: [] });
  }
}
