"use server";

import { prisma } from "@/lib/prisma";

export async function downgradeSubscription(billingCustomerId: string) {
  if (!billingCustomerId) {
    return { success: false, error: "Missing billingCustomerId" };
  }

  // Find the active subscription for this customer
  const subscription = await prisma.subscription.findFirst({
    where: {
      billingCustomerId,
      status: "active",
    },
  });

  if (!subscription) {
    return { success: false, error: "No active subscription found" };
  }

  // Downgrade the plan to free_trial
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan: "free_trial",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
      },
    }),
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: "downgraded",
        fromPlan: subscription.plan,
        toPlan: "free_trial",
      },
    }),
  ]);

  return { success: true };
}
