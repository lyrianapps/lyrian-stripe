import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions } from "@/lib/auth";
import type { BillingType, Session } from "@/lib/auth";

/**
 * POST /api/auth/register
 * Body: { userId, email, billingType }
 *
 * Called after the client stores credentials in localStorage.
 * Sets a signed JWT cookie so server routes can identify the user.
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

  if (billingType !== "flat_rate" && billingType !== "metered") {
    return NextResponse.json(
      { error: "billingType must be flat_rate or metered" },
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
