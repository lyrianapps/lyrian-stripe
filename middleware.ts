import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  try {
    if (req.nextUrl.pathname.startsWith("/subscription")) {
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
