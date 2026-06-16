/**
 * Stripe webhook sanity check
 *
 * Queries the DB for the first app that has a stripeWebhookSecret configured,
 * constructs a signed `ping` event, and POSTs it to the billing service's
 * webhook endpoint. Verifies the service returns 200, which confirms:
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

async function main() {
  const billingAppUrl = process.env.BILLING_APP_URL;

  if (!billingAppUrl) {
    console.error("Error: BILLING_APP_URL is not set");
    process.exit(1);
  }

  // Fetch the webhook secret from the DB — it's stored per-app, not as a
  // global env var. Use the first app that has one configured.
  const app = await prisma.app.findFirst({
    where: { stripeWebhookSecret: { not: null } },
    select: { id: true, stripeWebhookSecret: true },
  });

  if (!app?.stripeWebhookSecret) {
    console.warn(
      "No app with a stripeWebhookSecret found in the DB — skipping sanity check.",
    );
    process.exit(0);
  }

  const secret = decrypt(app.stripeWebhookSecret);
  console.log(`Using webhook secret from app ${app.id}`);
  const endpoint = `${billingAppUrl}/api/billing/webhook`;

  // Build a minimal Stripe-shaped ping event
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: "evt_sanity_check_ci",
    object: "event",
    type: "ping",
    livemode: false,
    created: timestamp,
    data: { object: {} },
  });

  // Stripe's signature scheme: HMAC-SHA256 over "<timestamp>.<payload>"
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const stripeSignature = `t=${timestamp},v1=${signature}`;

  console.log(`→ POST ${endpoint}`);

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
          console.log(`← Status: ${res.statusCode}`);
          console.log(`← Body:   ${body}`);

          if (res.statusCode !== 200) {
            console.error(
              `\nWebhook sanity check FAILED — expected 200, got ${res.statusCode}`,
            );
            console.error(
              "The service rejected the signature. Check that the stripeWebhookSecret " +
                "stored for this app in the DB matches the secret configured in Stripe.",
            );
            reject(new Error(`Unexpected status ${res.statusCode}`));
          } else {
            console.log("\nWebhook sanity check PASSED ✓");
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

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
