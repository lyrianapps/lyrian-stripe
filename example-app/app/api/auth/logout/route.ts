import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "POST /api/auth/logout" });

/** POST /api/auth/logout — clears the session cookie */
export async function POST() {
  log.info("User logged out");
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
