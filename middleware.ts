import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  try {
    if (req.nextUrl.pathname.startsWith("/subscription")) {
      // /subscription/success is the Stripe post-checkout callback — it has no
      // billing_session yet (the user came directly from checkout.stripe.com).
      // It reads session_id from the query string and redirects; no auth needed.
      if (req.nextUrl.pathname.startsWith("/subscription/success")) {
        return NextResponse.next();
      }

      const sessionId = req.cookies.get("billing_session")?.value;

      if (!sessionId) {
        console.error("unauthorized");
        return NextResponse.redirect(new URL("/unauthorized", req.url));
      }
    }
    return NextResponse.next();
  } catch (err) {
    console.error(err, "middleware");
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/subscription/:path*"],
};
