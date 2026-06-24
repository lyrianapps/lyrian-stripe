import { logger } from "@/app/middleware/logger";
import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyJWT } from "@/lib/session";
import { checkRateLimit } from "@/lib/middleware/rateLimit";
import { getPortalIdentifier } from "@/lib/rateLimit";

const log = logger.child({ route: "GET /api/billing/portal" });

export async function GET(req: NextRequest) {
  // ✅ Always use explicit base URL (Cloud Run safe)
  const origin = process.env.BILLING_APP_URL;

  if (!origin) {
    throw new Error("BILLING_APP_URL is not configured");
  }

  // Rate limit check: 60 requests per minute, keyed per user via JWT sub
  const rateLimitResult = await checkRateLimit(
    req,
    "portal",
    getPortalIdentifier,
  );
  if (!rateLimitResult.allowed) {
    const response = NextResponse.redirect(`${origin}/unauthorized`);
    Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  try {
    const token = req.nextUrl.searchParams.get("token");

    if (!token) {
      return NextResponse.redirect(`${origin}/unauthorized`);
    }

    // ✅ Verify token (JWT from SaaS)
    let payload;

    try {
      payload = verifyJWT(token);
    } catch (err) {
      log.error({ err }, "billing/portal GET");
      console.error("JWT verification failed", {
        message: err instanceof Error ? err.message : String(err),
        tokenPrefix: token?.slice(0, 20),
      });

      return NextResponse.redirect(`${origin}/unauthorized`);
    }

    // ✅ Create server-side session
    const sessionToken = await createSession({
      appId: payload.iss as string,
      externalUserId: payload.sub as string,
      email: payload.email as string,
    });

    // ✅ Default redirect
    let redirectTo = `${origin}/subscription`;

    // ✅ Safely handle optional returnUrl
    try {
      const returnUrl = payload.returnUrl as string | undefined;

      if (returnUrl) {
        const u = new URL(returnUrl);

        // Only allow valid http/https URLs
        if (["http:", "https:"].includes(u.protocol)) {
          redirectTo = `${redirectTo}?returnUrl=${encodeURIComponent(
            returnUrl,
          )}&appId=${encodeURIComponent(payload.iss as string)}`;
        }
      }
    } catch {
      // Ignore malformed returnUrl
    }

    // Forward billingType so the subscription page can adjust its UI
    const billingType = payload.billingType as string | undefined;
    if (billingType === "metered" || billingType === "flat_rate") {
      const separator = redirectTo.includes("?") ? "&" : "?";
      redirectTo = `${redirectTo}${separator}billingType=${billingType}`;
    }

    const response = NextResponse.redirect(redirectTo);

    // ✅ Secure session cookie
    // `secure` is only enforced over HTTPS — don't set it on plain HTTP so
    // the cookie isn't silently dropped when the service is accessed via http://
    // (e.g. localhost in dev/test environments).
    const isSecure = origin?.startsWith("https://") ?? false;
    response.cookies.set("billing_session", sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60, // 1 hour
    });

    return response;
  } catch (err) {
    log.error({ err }, "billing/portal GET");
    return NextResponse.redirect(`${origin}/unauthorized`);
  }
}
