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
import { SignJWT, jwtVerify } from "jose";
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
    const secret = new TextEncoder().encode(env.SAAS_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const { userId, email, billingType } = payload as unknown as Session;
    if (!userId || !email || !billingType) return null;
    return { userId, email, billingType };
  } catch {
    return null;
  }
}

export async function createSessionToken(session: Session): Promise<string> {
  const secret = new TextEncoder().encode(env.SAAS_JWT_SECRET);
  return new SignJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
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
