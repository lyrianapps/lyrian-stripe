import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Disabled in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const cookie = req.cookies.get("dev_admin");
  if (cookie && cookie.value === "1") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false }, { status: 401 });
}
