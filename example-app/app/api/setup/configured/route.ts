import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({
  route: "GET /api/setup/configured",
  service: "example-app",
});

/**
 * GET /api/setup/configured
 *
 * Proxies to the billing service's /api/apps/[appId]/configured endpoint.
 * Returns { configured: boolean }.
 *
 * Called by middleware to gate user access until setup is complete.
 * Kept as a separate route so middleware doesn't call the billing service directly.
 */
export async function GET() {
  try {
    const res = await fetch(
      `${env.BILLING_API_URL}/api/apps/${env.BILLING_APP_ID}/configured`,
      {
        headers: { "x-api-key": env.BILLING_API_KEY },
        cache: "no-store",
      },
    );

    const data = (await res.json()) as { configured?: boolean };
    const configured = data.configured ?? false;
    log.debug({ configured }, "Configured check result");
    return NextResponse.json({ configured });
  } catch (err) {
    // If billing service is unreachable, fail open so a service outage
    // doesn't permanently lock users out.
    log.error(
      { err },
      "Failed to reach billing service for configured check — failing open",
    );
    return NextResponse.json({ configured: true });
  }
}
