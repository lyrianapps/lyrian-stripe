import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { billingCustomerId } = await req.json();
  if (!billingCustomerId) {
    return NextResponse.json(
      { error: "Missing billingCustomerId" },
      { status: 400 },
    );
  }

  // Find the active subscription for this customer
  const subscription = await prisma.subscription.findFirst({
    where: {
      billingCustomerId,
      status: "active",
    },
  });

  if (!subscription) {
    return NextResponse.json(
      { error: "No active subscription found" },
      { status: 404 },
    );
  }

  // Downgrade the plan to free_trial
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      plan: "free_trial",
      status: "active",
      cancelAtPeriodEnd: false,
      // Optionally, set new period dates
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
