import { NextRequest, NextResponse } from "next/server";

// Note: this middleware runs on the Edge Runtime, so it CANNOT import Prisma
// or any Node-only module. The DB lookup for a custom domain happens in the
// route handlers (see app/api/billing/portal/route.ts) — the middleware just
// forwards the resolved hostname so routes have a consistent signal.

export function middleware(req: NextRequest) {
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

    // Forward the request hostname (minus port) so route handlers can look up
    // the app by customDomain when the request comes in via a custom domain.
    const host = req.headers.get("host") ?? "";
    const hostname = host.split(":")[0];

    const res = NextResponse.next();
    res.headers.set("x-request-hostname", hostname);
    return res;
  } catch (err) {
    console.error(err, "middleware");
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/subscription/:path*", "/api/billing/portal"],
};
