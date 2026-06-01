import { NextRequest, NextResponse } from "next/server";
import { getBillingPortalUrl } from "@/lib/billing";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "GET /api/billing/portal-redirect" });

/**
 * GET /api/billing/portal-redirect?returnUrl=...
 *
 * Signs a short-lived JWT and redirects the browser to the billing service's
 * hosted portal page. The billing service verifies the JWT and drops a session
 * cookie so the user can manage their subscription.
 *
 * Only allows same-origin returnUrls to prevent open redirect abuse.
 */
export async function GET(req: NextRequest) {
  const rawReturn = req.nextUrl.searchParams.get("returnUrl");
  const defaultReturn = `${env.APP_URL}/settings`;

  let safeReturnUrl = defaultReturn;
  if (rawReturn) {
    try {
      const parsed = new URL(rawReturn);
      const appOrigin = new URL(env.APP_URL).origin;
      if (parsed.origin === appOrigin) {
        safeReturnUrl = rawReturn;
      }
    } catch {
      // Invalid URL — fall back to default
    }
  }

  const portalUrl = getBillingPortalUrl(env.TEST_USER_ID, safeReturnUrl);
  log.info({ returnUrl: safeReturnUrl }, "Redirecting to billing portal");
  return NextResponse.redirect(portalUrl);
}
