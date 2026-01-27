import { logError } from "@/app/middleware/logger";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.SAAS_JWT_SECRET || "changeme";

export async function GET(request: Request) {
  try {
    // Accept query params for iss and sub, or use defaults
    const url = new URL(request.url);
    const iss = url.searchParams.get("iss") || "testAppId";
    const sub = url.searchParams.get("sub") || "testUserId";

    // Create a JWT
    const token = jwt.sign({ iss, sub }, JWT_SECRET, { expiresIn: "1h" });

    // Build absolute URL for redirect
    const origin = url.origin;
    const redirectUrl = `${origin}/api/billing/portal?token=${token}`;
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    logError(err, "mock-login GET");

    console.log("err", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
