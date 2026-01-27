import { logError } from "@/app/middleware/logger";
import { NextResponse } from "next/server";
import { getCurrentSubscription } from "../../../../lib/utils/subscription";

export async function POST(request: Request) {
  try {
    const { appId, externalUserId } = await request.json();
    if (!appId || !externalUserId) {
      return NextResponse.json(
        { error: "Missing appId or externalUserId" },
        { status: 400 },
      );
    }
    const subscription = await getCurrentSubscription(appId, externalUserId);
    if (!subscription) {
      return NextResponse.json({ subscription: null }, { status: 200 });
    }
    return NextResponse.json({ subscription }, { status: 200 });
  } catch (err) {
    logError(err, "billing/subscription POST");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
