import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "POST /api/setup" });

const SetupSchema = z.object({
  stripeSecretKey: z.string().startsWith("sk_"),
  stripePublishableKey: z.string().startsWith("pk_"),
  stripeWebhookSecret: z.string().startsWith("whsec_"),
  plansJson: z.string().min(2),
});

/**
 * POST /api/setup
 *
 * Validates the developer's Stripe credentials and plan JSON, then forwards
 * them to the billing service's /api/apps/[appId]/configure endpoint.
 *
 * This is a POC-only route — it exists so a developer can configure their
 * Stripe settings via the example app UI without needing a workflow run.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const {
    stripeSecretKey,
    stripePublishableKey,
    stripeWebhookSecret,
    plansJson,
  } = parsed.data;

  // Parse the plans JSON submitted by the developer
  let plans: unknown;
  try {
    plans = JSON.parse(plansJson);
  } catch {
    return NextResponse.json(
      { error: "Plans JSON is not valid JSON" },
      { status: 400 },
    );
  }

  if (!Array.isArray(plans) || plans.length === 0) {
    return NextResponse.json(
      { error: "Plans JSON must be a non-empty array" },
      { status: 400 },
    );
  }

  // Forward to the billing service configure endpoint
  const url = `${env.BILLING_API_URL}/api/apps/${env.BILLING_APP_ID}/configure`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.BILLING_API_KEY,
      },
      body: JSON.stringify({
        stripeSecretKey,
        stripePublishableKey,
        stripeWebhookSecret,
        plans,
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      log.warn(
        { status: res.status, data },
        "Billing service configure failed",
      );
      return NextResponse.json(
        {
          error: (data.error as string) ?? "Configuration failed",
          details: data.details,
        },
        { status: res.status },
      );
    }

    log.info({ appId: env.BILLING_APP_ID }, "App configured via setup page");
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Failed to reach billing service");
    return NextResponse.json(
      { error: "Could not reach billing service" },
      { status: 502 },
    );
  }
}
