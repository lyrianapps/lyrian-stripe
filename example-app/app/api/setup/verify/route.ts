import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({
  route: "GET /api/setup/verify",
  service: "example-app",
});

/**
 * GET /api/setup/verify
 *
 * Proxies to the billing service's /api/apps/[appId]/verify endpoint to
 * confirm Stripe credentials are valid and plans are configured.
 */
export async function GET() {
  try {
    const res = await fetch(
      `${env.BILLING_API_URL}/api/apps/${env.BILLING_APP_ID}/verify`,
      {
        headers: { "x-api-key": env.BILLING_API_KEY },
        cache: "no-store",
      },
    );

    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    log.error({ err }, "Failed to reach billing service for verification");
    return NextResponse.json(
      { error: "Could not reach the billing service" },
      { status: 503 },
    );
  }
}
