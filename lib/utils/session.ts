import { prisma } from "@/lib/prisma";
import { SessionPayloadSchema } from "@/lib/session/schemas";

export async function verifyBillingSession(sessionId: string) {
  if (!sessionId.startsWith("bs_")) {
    return null;
  }

  const session = await prisma.billingSession.findUnique({
    where: { id: sessionId },
    include: {
      billingCustomer: true,
    },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    return null;
  }

  const payload = {
    sessionId: session.id,
    appId: session.appId,
    externalUserId: session.externalUserId,
    billingCustomerId: session.billingCustomerId,
  };

  SessionPayloadSchema.parse(payload);
  return payload;
}
