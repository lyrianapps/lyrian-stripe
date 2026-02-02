import { logError } from "@/app/middleware/logger";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { env } from "@/env";

const JWT_SECRET = env.SAAS_JWT_SECRET;

export async function GET(request: Request) {
  try {
    // Use hardcoded mock values for testing
    const mockAppId = "mock-app-127";
    const mockExternalUserId = "mock-user-458";

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
    logError(err, "mock-login GET");
    console.log("err", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
