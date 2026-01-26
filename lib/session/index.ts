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
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

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
