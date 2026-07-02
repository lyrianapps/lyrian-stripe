import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Paths that don't need host-based app resolution (webhooks, API key routes, cron, dev)
const BYPASS_PREFIXES = [
  "/api/billing/webhook",
  "/api/db-health-check",
  "/api/cron/",
  "/api/dev/",
  "/api/mock-login",
  "/_next/",
  "/favicon",
];

export async function middleware(req: NextRequest) {
  try {
    const { pathname } = req.nextUrl;

    // Gate /subscription/* on the billing_session cookie
    if (
      pathname.startsWith("/subscription") &&
      !pathname.startsWith("/subscription/success")
    ) {
      const sessionId = req.cookies.get("billing_session")?.value;
      if (!sessionId) {
        return NextResponse.redirect(new URL("/unauthorized", req.url));
      }
    }

    // Skip host resolution for paths that don't need it
    const bypass = BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
    if (bypass) return NextResponse.next();

    // Resolve app from custom domain
    const host = req.headers.get("host") ?? "";
    // Strip port for local dev (localhost:3000 → localhost)
    const hostname = host.split(":")[0];

    // Skip resolution for localhost / the raw Cloud Run URL (no customDomain row)
    const isRawServiceUrl =
      hostname === "localhost" || hostname.endsWith(".run.app");

    if (!isRawServiceUrl) {
      const app = await prisma.app.findUnique({
        where: { customDomain: hostname },
        select: { id: true },
      });

      if (!app) {
        // Unknown custom domain — reject at the edge
        return NextResponse.json(
          { error: "Unknown billing domain" },
          { status: 404 },
        );
      }

      // Inject the resolved appId so routes don't need to do a domain lookup
      const res = NextResponse.next();
      res.headers.set("x-billing-app-id", app.id);
      return res;
    }

    return NextResponse.next();
  } catch (err) {
    console.error(err, "middleware");
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/subscription/:path*",
    "/api/billing/portal",
    "/api/billing/checkout-return",
    "/api/subscription/:path*",
    "/api/usage/:path*",
    "/api/apps/:path*",
  ],
};
