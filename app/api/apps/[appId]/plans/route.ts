import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/apps/[appId]/plans
 *
 * Returns the pricing plans configured for a specific app.
 * This endpoint is called by the subscription page to display
 * app-specific pricing options.
 *
 * No authentication required - pricing is public info.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;

  if (!appId) {
    return NextResponse.json({ error: "App ID required" }, { status: 400 });
  }

  const app = await prisma.app.findUnique({
    where: { id: appId },
    include: {
      plans: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          planKey: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          interval: true,
          stripePriceId: true,
        },
      },
    },
  });

  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  return NextResponse.json({
    appId: app.id,
    appName: app.name,
    plans: app.plans,
  });
}
