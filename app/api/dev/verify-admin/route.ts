import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  // Disabled in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { token } = body as { token?: string };
  const expected = env.DEV_ADMIN_TOKEN;

  if (!expected) {
    return NextResponse.json(
      { error: "Admin token not configured" },
      { status: 500 },
    );
  }

  if (!token || token !== expected) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // set httpOnly cookie to allow subsequent requests from this browser
  res.cookies.set("dev_admin", "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });

  return res;
}
