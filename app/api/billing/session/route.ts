import { NextResponse } from "next/server";
import { verifyBillingSession } from "../../../../lib/utils/session";

export async function POST(request: Request) {
  const { sessionToken } = await request.json();
  if (!sessionToken) {
    return NextResponse.json(
      { error: "Missing sessionToken" },
      { status: 400 },
    );
  }
  const session = await verifyBillingSession(sessionToken);
  if (!session) {
    return NextResponse.json({ session: null }, { status: 200 });
  }
  return NextResponse.json({ session }, { status: 200 });
}
