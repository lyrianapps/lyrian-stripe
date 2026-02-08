import { NextRequest, NextResponse } from "next/server";
import jwt, { SignOptions, Secret } from "jsonwebtoken";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { appId, externalUserId, expiresMinutes } = body as {
    appId?: string;
    externalUserId?: string;
    expiresMinutes?: number;
  };

  if (!appId || !externalUserId) {
    return NextResponse.json(
      { error: "Missing appId or externalUserId" },
      { status: 400 },
    );
  }

  try {
    const secret = env.SAAS_JWT_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Missing SAAS_JWT_SECRET" },
        { status: 500 },
      );
    }

    const expiresIn = expiresMinutes ? `${expiresMinutes}m` : `15m`;

    const token = jwt.sign(
      { iss: appId, sub: externalUserId },
      secret as Secret,
      { expiresIn } as SignOptions,
    );

    const billingAppUrl = env.NEXT_PUBLIC_APP_URL;
    const portalUrl = `${billingAppUrl}/api/billing/portal?token=${encodeURIComponent(token)}`;

    return NextResponse.json({ url: portalUrl });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create portal token" },
      { status: 500 },
    );
  }
}
