import { logError } from "@/app/middleware/logger";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { verifyJWT } from "@/lib/session";
import { checkRateLimit } from "@/lib/middleware/rateLimit";

export async function GET(req: NextRequest) {
  // Rate limit check: 20 requests per minute
  const rateLimitResult = await checkRateLimit(req, "portal");
  if (!rateLimitResult.allowed) {
    const origin = req.nextUrl.origin;
    const response = NextResponse.redirect(`${origin}/unauthorized`);
    Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.redirect("/unauthorized");

    //verify token here (your JWT from SaaS)
    const payload = verifyJWT(token);

    // create server-side session
    const sessionToken = await createSession({
      appId: payload.iss as string,
      externalUserId: payload.sub as string,
    });

    // Build absolute URL for redirect and include optional returnUrl from the token
    const origin = req.nextUrl.origin;
    let redirectTo = `${origin}/subscription`;
    try {
      const returnUrl = payload.returnUrl as string | undefined;
      if (returnUrl) {
        const u = new URL(returnUrl);
        if (["http:", "https:"].includes(u.protocol) && u.origin) {
          redirectTo = `${redirectTo}?returnUrl=${encodeURIComponent(returnUrl)}&appId=${encodeURIComponent(
            payload.iss as string,
          )}`;
        }
      }
    } catch (e) {
      // ignore malformed returnUrl and proceed without it
    }

    const response = NextResponse.redirect(redirectTo);
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
    return NextResponse.redirect("/unauthorized");
  }
}
