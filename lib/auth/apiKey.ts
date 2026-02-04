import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { logError } from "@/app/middleware/logger";

export type ApiKeyValidationResult =
  | { valid: true; appId: string }
  | { valid: false; error: string; status: number };

type ProtectedRouteHandler = (
  req: NextRequest,
  context: { appId: string },
) => Promise<NextResponse>;

/**
 * Validate billing session from cookie (for internal UI)
 */
async function validateSession(
  req: NextRequest,
): Promise<ApiKeyValidationResult> {
  const sessionToken = req.cookies.get("billing_session")?.value;

  if (!sessionToken) {
    return { valid: false, error: "No session", status: 401 };
  }

  const session = await prisma.billingSession.findUnique({
    where: { id: sessionToken },
  });

  if (!session || session.expiresAt < new Date()) {
    return { valid: false, error: "Invalid or expired session", status: 401 };
  }

  return { valid: true, appId: session.appId };
}

/**
 * Wrap a route handler with flexible authentication
 *
 * Accepts either:
 * - x-api-key header (for external SaaS apps)
 * - billing_session cookie (for billing app's own UI)
 *
 * Usage:
 * ```ts
 * export const POST = withApiKey(async (req, { appId }) => {
 *   // appId is already validated
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withApiKey(handler: ProtectedRouteHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // Try API key first (for external SaaS apps)
    const apiKeyResult = await validateApiKey(req);
    if (apiKeyResult.valid) {
      try {
        return await handler(req, { appId: apiKeyResult.appId });
      } catch (error) {
        logError(error, "Protected route error");
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    }

    // Fall back to session cookie (for internal UI)
    const sessionResult = await validateSession(req);

    console.log("session denver", sessionResult);
    if (sessionResult.valid) {
      try {
        return await handler(req, { appId: sessionResult.appId });
      } catch (error) {
        logError(error, "Protected route error");
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    }

    // Neither worked
    return NextResponse.json(
      { error: "Unauthorized: missing x-api-key or valid session" },
      { status: 401 },
    );
  };
}

/**
 * Validate API key from request header
 *
 * Usage:
 * ```ts
 * const result = await validateApiKey(request);
 * if (!result.valid) {
 *   return NextResponse.json({ error: result.error }, { status: result.status });
 * }
 * const { appId } = result;
 * ```
 */
export async function validateApiKey(
  request: NextRequest,
): Promise<ApiKeyValidationResult> {
  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return {
      valid: false,
      error: "Missing x-api-key header",
      status: 401,
    };
  }

  const app = await prisma.app.findUnique({
    where: { apiKey },
    select: { id: true },
  });

  if (!app) {
    return {
      valid: false,
      error: "Invalid API key",
      status: 401,
    };
  }

  return { valid: true, appId: app.id };
}

/**
 * Generate a new API key for an app
 * Format: sk_live_<32 random hex chars>
 */
export function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  return `sk_live_${randomPart}`;
}

/**
 * Helper to create unauthorized response
 */
export function unauthorizedResponse(message: string = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}
