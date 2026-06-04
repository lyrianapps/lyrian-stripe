/**
 * Cookie-based auth for the example app.
 *
 * Session payload is a signed JWT containing:
 *   - userId  : UUID generated at registration (used as externalUserId in billing)
 *   - email   : user's email
 *   - billingType : "flat_rate" | "metered" — chosen at registration, immutable
 *
 * No DB table for users — auth state lives in the cookie only.
 * localStorage stores the credential for login verification (client-side).
 */
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { env } from "@/lib/env";

export type BillingType = "flat_rate" | "metered";

export interface Session {
  userId: string;
  email: string;
  billingType: BillingType;
}

const COOKIE_NAME = "app_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.SAAS_JWT_SECRET) as Session;
    if (!payload.userId || !payload.email || !payload.billingType) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(session: Session): string {
  return jwt.sign(session, env.SAAS_JWT_SECRET, { expiresIn: "30d" });
}

export function sessionCookieOptions(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}
