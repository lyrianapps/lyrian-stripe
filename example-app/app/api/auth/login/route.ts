import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions } from "@/lib/auth";
import type { BillingType, Session } from "@/lib/auth";

/**
 * POST /api/auth/login
 * Body: { userId, email, billingType }
 *
 * The client verifies the password against the localStorage hash, then
 * calls this endpoint to refresh the server-side cookie.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, email, billingType } = body as {
    userId?: string;
    email?: string;
    billingType?: string;
  };

  if (!userId || !email || !billingType) {
    return NextResponse.json(
      { error: "userId, email, and billingType are required" },
      { status: 400 },
    );
  }

  const session: Session = {
    userId,
    email,
    billingType: billingType as BillingType,
  };

  const token = createSessionToken(session);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
