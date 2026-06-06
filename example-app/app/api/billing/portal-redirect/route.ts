import { NextRequest, NextResponse } from "next/server";
import { getBillingPortalUrl } from "@/lib/billing";
import { getSession } from "@/lib/auth";
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

  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const portalUrl = getBillingPortalUrl(
    session.userId,
    safeReturnUrl,
    session.billingType,
  );
  log.info(
    { returnUrl: safeReturnUrl, billingType: session.billingType },
    "Redirecting to billing portal",
  );
  return NextResponse.redirect(portalUrl);
}
