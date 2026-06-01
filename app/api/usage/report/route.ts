import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/auth/apiKey";
import { withRateLimit } from "@/lib/middleware/rateLimit";
import { reportUsage } from "@/lib/services/usageService";

import { logger } from "@/app/middleware/logger";
import { z } from "zod";

const ReportUsageSchema = z.object({
  appId: z.string().min(1),
  externalUserId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
});

const log = logger.child({ route: "POST /api/usage/report" });
const reportHandler = withApiKey(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    log.error({ err }, "Malformed JSON body");
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = ReportUsageSchema.safeParse(body);
  if (!parsed.success) {
    log.warn({ details: parsed.error.flatten() }, "Invalid request body");
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { appId, externalUserId, quantity } = parsed.data;
  const result = await reportUsage({ appId, externalUserId, quantity });

  if (!result.allowed) {
    log.warn(
      {
        appId,
        externalUserId,
        used: result.used,
        cap: result.cap,
        plan: result.plan,
      },
      "Usage cap hit",
    );
  } else {
    log.info(
      { appId, externalUserId, used: result.used, plan: result.plan },
      "Usage reported",
    );
  }

  // 402 signals the cap was hit so the caller can show an upgrade prompt
  return NextResponse.json(result, { status: result.allowed ? 200 : 402 });
});

export const POST = withRateLimit("usage", reportHandler);
