import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/register",
  "/api/auth/login",
  "/api/health",
];

// Routes the setup gate itself needs — always allow through
const SETUP_PATHS = ["/setup", "/api/setup"];

// ─── Configured-state cache ───────────────────────────────────────────────────
// Avoids hitting the billing service on every request.
// Module-level so it persists across requests within the same instance.
let configuredCache: { value: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 s

async function fetchIsConfigured(origin: string): Promise<boolean> {
  if (configuredCache && Date.now() < configuredCache.expiresAt) {
    return configuredCache.value;
  }
  try {
    const res = await fetch(`${origin}/api/setup/configured`, {
      cache: "no-store",
    });
    const data = (await res.json()) as { configured?: boolean };
    const value = data.configured ?? false;
    configuredCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    // Billing service unreachable — fail open
    return true;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Always allow setup paths so the operator can configure the app
  if (SETUP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check JWT first — unauthenticated users go to login regardless
  const token = req.cookies.get("app_session")?.value;
  const secret = new TextEncoder().encode(process.env.SAAS_JWT_SECRET ?? "");

  let authenticated = false;
  if (token && secret.length > 0) {
    try {
      await jwtVerify(token, secret);
      authenticated = true;
    } catch {
      // Invalid token
    }
  }

  if (!authenticated) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — check that Stripe setup has been completed.
  // Skip in E2E test environments so tests don't need real Stripe credentials.
  const e2eMode = process.env.ENABLE_E2E_SHORTCUTS === "true";
  if (!e2eMode) {
    const origin = req.nextUrl.origin;
    const configured = await fetchIsConfigured(origin);
    if (!configured) {
      const setupUrl = req.nextUrl.clone();
      setupUrl.pathname = "/setup";
      return NextResponse.redirect(setupUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
