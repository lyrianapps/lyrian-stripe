import { logError } from "@/app/middleware/logger";
import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyJWT } from "@/lib/session";
import { checkRateLimit } from "@/lib/middleware/rateLimit";
import { getPortalIdentifier } from "@/lib/rateLimit";

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
    const payload = verifyJWT(token);

    // ✅ Create server-side session
    const sessionToken = await createSession({
      appId: payload.iss as string,
      externalUserId: payload.sub as string,
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

    const response = NextResponse.redirect(redirectTo);

    // ✅ Secure session cookie
    response.cookies.set("billing_session", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60, // 1 hour
    });

    return response;
  } catch (err) {
    logError(err, "billing/portal GET");
    return NextResponse.redirect(`${origin}/unauthorized`);
  }
}
