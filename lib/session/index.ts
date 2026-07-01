import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import {
  SessionPayloadSchema,
  JWTTokenSchema,
  JWTPayloadSchema,
} from "./schemas";
import { logger } from "@/app/middleware/logger";
import { env } from "@/env";
import { decrypt } from "@/lib/crypto";

const log = logger.child({ module: "session" });

/**
 * Resolves the JWT signing secret for a given app.
 * Uses the per-app jwtSecret from the DB when available, falls back to the
 * global SAAS_JWT_SECRET env var for apps that haven't set one.
 */
async function getJwtSecretForApp(appId: string): Promise<string> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { jwtSecret: true },
  });
  const perApp = app?.jwtSecret ? decrypt(app.jwtSecret) : null;
  const secret = perApp ?? env.SAAS_JWT_SECRET;
  if (!secret) {
    throw new Error(`No JWT secret configured for app ${appId}`);
  }
  return secret;
}

export async function createSession(payload: {
  appId: string;
  externalUserId: string;
  email?: string;
}) {
  try {
    // Validate payload
    SessionPayloadSchema.parse(payload);
    // Step 0: Ensure the App exists
    await prisma.app.upsert({
      where: { id: payload.appId },
      update: {},
      create: { id: payload.appId, name: payload.appId },
    });

    // Step 1: Find the BillingCustomer for this user
    let customer = await prisma.billingCustomer.findUnique({
      where: {
        appId_externalUserId: {
          appId: payload.appId,
          externalUserId: payload.externalUserId,
        },
      },
    });

    // Optional: create the customer if it doesn't exist
    if (!customer) {
      try {
        customer = await prisma.billingCustomer.create({
          data: {
            appId: payload.appId,
            email: payload.email,
            externalUserId: payload.externalUserId,
            stripeCustomerId: "placeholder_" + randomBytes(8).toString("hex"), // placeholder
          },
        });
      } catch (err) {
        console.error("Error creating BillingCustomer:", err);
        throw err;
      }
    }

    // Step 2: Create a BillingSession for this customer
    const sessionId = "bs_" + randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await prisma.billingSession.create({
      data: {
        id: sessionId,
        appId: payload.appId,
        externalUserId: payload.externalUserId,
        expiresAt,
        email: payload.email,
        billingCustomer: { connect: { id: customer.id } }, // ✅ connect to real customer
      },
    });

    return sessionId;
  } catch (err) {
    console.error("createSession error:", err);
    throw err;
  }
}

export async function verifyJWT(token: string): Promise<JwtPayload> {
  JWTTokenSchema.parse(token);

  // Decode without verifying first to extract `iss` (the app ID), so we can
  // look up the correct per-app secret before running full verification.
  const unverified = jwt.decode(token) as JwtPayload | null;
  if (!unverified?.iss) {
    throw new Error("JWT missing iss claim");
  }

  const secret = await getJwtSecretForApp(unverified.iss);

  try {
    const payload = jwt.verify(token, secret);
    JWTPayloadSchema.parse(payload);
    return payload as JwtPayload;
  } catch (err) {
    console.error("JWT verify error", {
      name: err instanceof Error ? err.name : undefined,
      message: err instanceof Error ? err.message : String(err),
      appId: unverified.iss,
    });
    throw err;
  }
}

export async function getSession(sessionId: string): Promise<{
  sessionId: string;
  appId: string;
  externalUserId: string;
  billingCustomerId: string;
  email: string;
} | null> {
  try {
    // Validate format if you want (optional)
    if (!sessionId.startsWith("bs_")) {
      throw new Error("Invalid session id format");
    }

    const session = await prisma.billingSession.findUnique({
      where: { id: sessionId },
      include: {
        billingCustomer: true,
      },
    });

    if (!session) {
      log.error("Session not found!");
      throw new Error("Session not found");
    }

    // Expired?
    if (session.expiresAt < new Date()) {
      log.error("Session Expired");
      throw new Error("Session expired");
    }

    // Optional: single-use or revoked
    // if (session.usedAt) return null;

    const payload = {
      sessionId: session.id,
      appId: session.appId,
      externalUserId: session.externalUserId,
      billingCustomerId: session.billingCustomerId,
      email: session.billingCustomer.email || "",
    };

    // Optional schema validation
    SessionPayloadSchema.parse(payload);

    return payload;
  } catch (err) {
    log.error({ err }, "getSession");
    return null;
  }
}
