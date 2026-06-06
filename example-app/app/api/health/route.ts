import { NextResponse } from "next/server";

/** GET /api/health — liveness check. No DB required. */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
