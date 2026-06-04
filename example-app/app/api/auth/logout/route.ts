import { NextResponse } from "next/server";

/** POST /api/auth/logout — clears the session cookie */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "app_session",
    value: "",
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
