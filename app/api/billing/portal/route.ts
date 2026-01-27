import { logError } from "@/app/middleware/logger";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { verifyJWT } from "@/lib/session";

export async function GET(req: NextRequest) {
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

    // Build absolute URL for redirect
    const origin = req.nextUrl.origin;
    const response = NextResponse.redirect(`${origin}/subscription`);
    response.cookies.set("billing_session", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    });

    return response;
  } catch (err) {
    logError(err, "billing/portal GET");
    return NextResponse.redirect("/unauthorized");
  }
}
