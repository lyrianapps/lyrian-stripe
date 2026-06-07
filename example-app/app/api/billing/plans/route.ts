import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/auth";

const log = logger.child({ route: "GET /api/billing/plans" });

/**
 * GET /api/billing/plans
 *
 * Proxies to the billing service's GET /api/apps/:appId/plans endpoint.
 * All plan data (names, descriptions, price IDs, billing types) lives in
 * the billing service — no need to duplicate it here as env vars.
 */
export async function GET() {
  const session = await getSession();
  const billingType = session?.billingType ?? "flat_rate";

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

    // Shape the response to match what SettingsPage expects,
    // filtering to only the plans that match the user's billing type.
    const plans = data.plans
      .filter((p) =>
        billingType === "metered"
          ? p.billingType === "metered" || p.billingType === "volume"
          : p.billingType === "flat_rate",
      )
      .map((p) => ({
        key: p.planKey,
        name: p.name,
        description: p.description ?? "",
        price:
          p.billingType === "metered" || p.billingType === "volume"
            ? "Usage-based"
            : p.price === 0
              ? "Free"
              : `$${(p.price / 100).toFixed(2)} / mo`,
        billingType: p.billingType,
        cap: p.freeUnitsPerMonth,
        priceId: p.stripePriceId,
      }));

    log.debug({ count: plans.length }, "Plans fetched");
    return NextResponse.json({ plans });
  } catch (err) {
    log.error({ err }, "Failed to fetch plans");
    return NextResponse.json({ plans: [] });
  }
}
