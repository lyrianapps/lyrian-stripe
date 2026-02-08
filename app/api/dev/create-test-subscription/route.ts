import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { z } from "zod";
import { logError } from "@/app/middleware/logger";

const DevCreateSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  minutes: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  // Disabled in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = DevCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { appId, externalUserId, minutes = 30 } = parsed.data;

  try {
    await prisma.app.upsert({
      where: { id: appId },
      update: {},
      create: { id: appId, name: appId },
    });

    let customer = await prisma.billingCustomer.findUnique({
      where: { appId_externalUserId: { appId, externalUserId } },
    });

    if (!customer) {
      customer = await prisma.billingCustomer.create({
        data: {
          appId,
          externalUserId,
          stripeCustomerId: "placeholder_" + randomBytes(6).toString("hex"),
        },
      });
    }

    const now = new Date();
    const end = new Date(now.getTime() + minutes * 60 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        billingCustomer: { connect: { id: customer.id } },
        stripeSubscriptionId: `dev_test_${randomBytes(8).toString("hex")}`,
        stripePriceId: "dev_test_price",
        stripeProductId: "dev_test_product",
        plan: "free_trial",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
      },
    });

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });
  } catch (err) {
    logError(err, "dev/create-test-subscription");
    return NextResponse.json(
      { error: "Failed to create test subscription" },
      { status: 500 },
    );
  }
}
