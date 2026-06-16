/**
 * Stripe webhook sanity check
 *
 * Queries the DB for all apps that have a stripeWebhookSecret configured,
 * constructs a signed `ping` event for each, and POSTs it to the billing
 * service's per-app webhook endpoint. Verifies the service returns 200, which
 * confirms:
 *   - The per-app stripeWebhookSecret in the DB matches what the service uses
 *   - The webhook route is reachable and not crashing on startup
 *
 * The `ping` event type is not handled by the webhook pipeline so it is
 * completely side-effect free (no DB writes, no emails sent).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... BILLING_APP_URL=https://... npx tsx scripts/webhook-sanity-check.ts
 */

import "dotenv/config";
import crypto from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

async function pingApp(
  billingAppUrl: string,
  appId: string,
  secret: string,
): Promise<void> {
  const endpoint = `${billingAppUrl}/api/billing/webhook/${appId}`;

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: `evt_sanity_check_${appId}`,
    object: "event",
    type: "ping",
    livemode: false,
    created: timestamp,
    data: { object: {} },
  });

  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const stripeSignature = `t=${timestamp},v1=${signature}`;

  console.log(`  → POST ${endpoint}`);

  const parsed = new URL(endpoint);
  const transport = parsed.protocol === "https:" ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "stripe-signature": stripeSignature,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          console.log(`  ← Status: ${res.statusCode}`);
          if (res.statusCode !== 200) {
            console.error(`  ← Body:   ${body}`);
            reject(new Error(`Expected 200, got ${res.statusCode}`));
          } else {
            resolve();
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const billingAppUrl = process.env.BILLING_APP_URL;

  if (!billingAppUrl) {
    console.error("Error: BILLING_APP_URL is not set");
    process.exit(1);
  }

  const apps = await prisma.app.findMany({
    where: { stripeWebhookSecret: { not: null } },
    select: { id: true, stripeWebhookSecret: true },
  });

  if (apps.length === 0) {
    console.warn(
      "No apps with a stripeWebhookSecret found — skipping sanity check.",
    );
    process.exit(0);
  }

  console.log(`Checking ${apps.length} app(s)...\n`);

  const failures: string[] = [];

  for (const app of apps) {
    console.log(`[${app.id}]`);
    const raw = app.stripeWebhookSecret!;
    const secret = decrypt(raw);
    console.log(
      `  Source: ${raw.startsWith("enc:v1:") ? "decrypted from DB" : "plain-text from DB"}`,
    );

    if (!secret.startsWith("whsec_")) {
      console.error(
        `  SKIP: Decrypted value does not look like a Stripe webhook secret.\n` +
          `  This usually means FIELD_ENCRYPTION_KEY does not match the key used to encrypt the DB record.`,
      );
      failures.push(app.id);
      continue;
    }

    try {
      await pingApp(billingAppUrl, app.id, secret);
      console.log(`  PASSED ✓\n`);
    } catch (err) {
      console.error(
        `  FAILED: ${err instanceof Error ? err.message : err}\n` +
          `  Check that the stripeWebhookSecret in the DB matches the secret configured in Stripe.\n`,
      );
      failures.push(app.id);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} app(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }

  console.log(`All ${apps.length} app(s) passed ✓`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
