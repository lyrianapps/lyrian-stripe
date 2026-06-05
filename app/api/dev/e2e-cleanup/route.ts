import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logger } from "@/app/middleware/logger";

const log = logger.child({ route: "POST /api/dev/e2e-cleanup" });

const E2ECleanupSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
});

/**
 * POST /api/dev/e2e-cleanup
 *
 * Deletes all billing data for a given externalUserId created during e2e tests.
 * Cascades through: BillingSession, MonthlyUsage, PaymentEvent,
 * SubscriptionEvent, Subscription, BillingCustomer.
 *
 * Only available when ENABLE_E2E_SHORTCUTS=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_E2E_SHORTCUTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = E2ECleanupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { appId, externalUserId } = parsed.data;

  try {
    const customer = await prisma.billingCustomer.findUnique({
      where: { appId_externalUserId: { appId, externalUserId } },
      select: { id: true },
    });

    if (!customer) {
      // Nothing to clean up — treat as success
      return NextResponse.json({ success: true, deleted: false });
    }

    const customerId = customer.id;

    await prisma.$transaction(async (tx) => {
      // Find subscription IDs for cascade
      const subs = await tx.subscription.findMany({
        where: { billingCustomerId: customerId },
        select: { id: true },
      });
      const subIds = subs.map((s) => s.id);

      // Delete in dependency order
      if (subIds.length > 0) {
        await tx.subscriptionEvent.deleteMany({
          where: { subscriptionId: { in: subIds } },
        });
      }
      await tx.subscription.deleteMany({
        where: { billingCustomerId: customerId },
      });
      await tx.paymentEvent.deleteMany({
        where: { billingCustomerId: customerId },
      });
      await tx.monthlyUsage.deleteMany({
        where: { billingCustomerId: customerId },
      });
      await tx.billingSession.deleteMany({
        where: { billingCustomerId: customerId },
      });
      await tx.billingCustomer.delete({ where: { id: customerId } });
    });

    log.info(
      { appId, externalUserId },
      "e2e-cleanup: deleted billing customer and all related records",
    );
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    log.error({ err: error }, "e2e-cleanup failed");
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
