import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import {
  SessionPayloadSchema,
  JWTTokenSchema,
  JWTPayloadSchema,
} from "./schemas";

const JWT_SECRET = process.env.SAAS_JWT_SECRET || "changeme";

export async function createSession(payload: {
  appId: string;
  externalUserId: string;
}) {
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
    customer = await prisma.billingCustomer.create({
      data: {
        appId: payload.appId,
        externalUserId: payload.externalUserId,
        stripeCustomerId: "placeholder_" + randomBytes(8).toString("hex"), // placeholder
      },
    });
  }

  // Step 2: Create a BillingSession for this customer
  const sessionId = "bs_" + randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1 * 60 * 1000); // 1 min

  await prisma.billingSession.create({
    data: {
      id: sessionId,
      appId: payload.appId,
      externalUserId: payload.externalUserId,
      expiresAt,
      billingCustomer: { connect: { id: customer.id } }, // ✅ connect to real customer
    },
  });

  return sessionId;
}

export function verifyJWT(token: string): JwtPayload {
  JWTTokenSchema.parse(token);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    JWTPayloadSchema.parse(payload);
    return payload as JwtPayload;
  } catch (err) {
    throw new Error("Invalid or expired JWT");
  }
}

export async function getSession(sessionId: string) {
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
      throw new Error("Session not found");
    }

    // Expired?
    if (session.expiresAt < new Date()) {
      throw new Error("Session expired");
    }

    // Optional: single-use or revoked
    // if (session.usedAt) return null;

    const payload = {
      sessionId: session.id,
      appId: session.appId,
      externalUserId: session.externalUserId,
      billingCustomerId: session.billingCustomerId,
    };

    // Optional schema validation
    SessionPayloadSchema.parse(payload);

    return payload;
  } catch (err) {
    console.error("getSession error:", err);
    return null;
  }
}
