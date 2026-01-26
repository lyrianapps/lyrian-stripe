import { prisma } from "@/lib/prisma";

export async function getCurrentSubscription(
  appId: string,
  externalUserId: string,
) {
  const customer = await prisma.billingCustomer.findUnique({
    where: {
      appId_externalUserId: {
        appId,
        externalUserId,
      },
    },
    include: {
      subscriptions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!customer || customer.subscriptions.length === 0) {
    return null;
  }

  return customer.subscriptions[0];
}
