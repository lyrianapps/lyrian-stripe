import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { verifyJWT } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect("/unauthorized");

  //verify token here (your JWT from SaaS)
  const payload = verifyJWT(token);

  // create server-side session
  const sessionToken = await createSession({
    appId: payload.iss as string,
    externalUserId: payload.sub as string,
  });

  const response = NextResponse.redirect("/subscription");
  response.cookies.set("billing_session", sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });

  return response;
}
