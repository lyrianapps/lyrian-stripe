import { logger } from "@/app/middleware/logger";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { env } from "@/env";

const log = logger.child({ route: "GET /api/mock-login" });

export async function GET(request: Request) {
  // Disable in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const JWT_SECRET = env.SAAS_JWT_SECRET;
  if (!JWT_SECRET) {
    return NextResponse.json(
      { error: "SAAS_JWT_SECRET is not set — required for mock-login" },
      { status: 500 },
    );
  }

  try {
    // Use hardcoded mock values for testing
    const mockAppId = "mock-app-128";
    const mockExternalUserId = "mock-user-459";

    // Create a JWT
    const token = jwt.sign(
      { iss: mockAppId, sub: mockExternalUserId },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Build absolute URL for redirect
    const url = new URL(request.url);
    const origin = url.origin;
    const redirectUrl = `${origin}/api/billing/portal?token=${token}`;
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    log.error({ err }, "mock-login GET");
    console.log("err", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
