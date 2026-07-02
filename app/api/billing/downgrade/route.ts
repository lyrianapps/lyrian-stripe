import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/auth/apiKey";
import { z } from "zod";

const DowngradeRequestSchema = z.object({
  billingCustomerId: z.string().min(1),
});

export const POST = withApiKey(async (req: NextRequest, { appId }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = DowngradeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { billingCustomerId } = parsed.data;

  // Verify the billingCustomer belongs to the authenticated app
  const customer = await prisma.billingCustomer.findUnique({
    where: { id: billingCustomerId },
    select: { appId: true },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  if (customer.appId !== appId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      plan: "free_trial",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
    },
  });

  return NextResponse.json({ success: true });
});
