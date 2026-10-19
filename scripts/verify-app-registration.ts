/**
 * Post-registration smoke check for a SaaS app.
 *
 * Runs after `create-app.ts` inside the Register App GitHub workflow. Reports
 * pass/warn/fail for each check but exits 0 so it can't accidentally block a
 * registration — the goal is early warning, not gate-keeping.
 *
 * Usage:
 *   npx tsx scripts/verify-app-registration.ts <app-id>
 *
 * Reads (all optional except APP-ID positional):
 *   BILLING_APP_URL           – portal URL for the target env (used to self-ping the webhook route)
 *   APP_STRIPE_SECRET_KEY     – plaintext, only present during a fresh registration
 *   APP_SAAS_URL              – URL of the SaaS to reachability-check
 *   APP_SAAS_JWT_SECRET       – plaintext, only present during a fresh registration
 *
 * Exit codes:
 *   0  always (checks are advisory)
 */

import "dotenv/config";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { decryptField } from "../lib/crypto";

const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

type Status = "pass" | "warn" | "fail";
interface CheckResult {
  name: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];
function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
  const icon = status === "pass" ? "✅" : status === "warn" ? "⚠️ " : "❌";
  console.log(`   ${icon} ${name}: ${detail}`);
}

// ─── Checks ───────────────────────────────────────────────────────────────────

async function checkAppRow(appId: string) {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: {
      id: true,
      name: true,
      stripeSecretKey: true,
      stripeWebhookSecret: true,
      jwtSecret: true,
      customDomain: true,
    },
  });
  if (!app) {
    record("App row", "fail", `no App with id="${appId}" — create-app failed?`);
    return null;
  }
  const missing = [];
  if (!app.stripeSecretKey) missing.push("stripeSecretKey");
  if (!app.stripeWebhookSecret) missing.push("stripeWebhookSecret");
  if (!app.jwtSecret) missing.push("jwtSecret (falls back to global)");
  const detail = missing.length
    ? `found — but missing: ${missing.join(", ")}`
    : `found (name="${app.name}"${app.customDomain ? `, customDomain="${app.customDomain}"` : ""})`;
  record("App row", missing.length ? "warn" : "pass", detail);
  return app;
}

async function checkStripeKey(
  storedEncryptedKey: string | null,
): Promise<Stripe | null> {
  // Prefer the plaintext env var (only present during a fresh registration),
  // otherwise decrypt the stored one so standalone re-runs still work.
  const source = process.env.APP_STRIPE_SECRET_KEY ? "input" : "stored";
  let key: string | null | undefined = process.env.APP_STRIPE_SECRET_KEY;
  if (!key) {
    try {
      key = decryptField(storedEncryptedKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      record(
        "Stripe secret key",
        "fail",
        `failed to decrypt stored key: ${msg} (FIELD_ENCRYPTION_KEY mismatch?)`,
      );
      return null;
    }
  }
  if (!key) {
    record(
      "Stripe secret key",
      "warn",
      "no key available (neither APP_STRIPE_SECRET_KEY nor App.stripeSecretKey set) — skipping",
    );
    return null;
  }
  const stripe = new Stripe(key, { apiVersion: "2025-12-15.clover" });
  try {
    const balance = await stripe.balance.retrieve();
    const mode = balance.livemode ? "LIVE" : "TEST";
    record(
      "Stripe secret key",
      "pass",
      `works — key is in ${mode} mode (source: ${source})`,
    );
    return stripe;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      "Stripe secret key",
      "fail",
      `stripe.balance.retrieve failed: ${msg}`,
    );
    return null;
  }
}

// Billing service hosts look like billing.<app>.com or lyrian-stripe-<env>-*.run.app.
function isBillingHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return host.includes("lyrian") || host.startsWith("billing.");
  } catch {
    return false;
  }
}

async function checkStripeWebhookEndpoints(stripe: Stripe, appId: string) {
  let endpoints: Stripe.WebhookEndpoint[];
  try {
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    endpoints = list.data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      "Stripe webhook endpoints",
      "warn",
      `could not list endpoints: ${msg} (Workbench Event Destinations aren't listed here — check manually)`,
    );
    return;
  }

  const suffix = `/api/billing/webhook/${appId}`;
  const pathMatches = endpoints.filter(
    (e) => e.url.endsWith(suffix) && e.status === "enabled",
  );

  // A correct path on the wrong host (e.g. the SaaS's own service) silently drops every event.
  const matching = pathMatches.filter((e) => isBillingHost(e.url));
  const wrongHost = pathMatches.filter((e) => !isBillingHost(e.url));
  if (wrongHost.length) {
    record(
      "Stripe webhook host",
      "fail",
      `endpoint(s) ${wrongHost.map((e) => e.url).join(", ")} don't point at the billing service (host must contain "lyrian" or start with "billing.")`,
    );
  } else if (matching.length) {
    record(
      "Stripe webhook host",
      "pass",
      `${matching[0].url} points at the billing service`,
    );
  }

  if (matching.length === 0) {
    if (pathMatches.length) return;
    const nearest = endpoints
      .filter((e) => e.url.includes("/api/billing/webhook/"))
      .map((e) => e.url)
      .slice(0, 3);
    const hint = nearest.length
      ? ` — nearest matches: ${nearest.join(", ")}`
      : "";
    record(
      "Stripe webhook endpoint",
      "warn",
      `no classic endpoint found for "${suffix}"${hint}. If you use Workbench Event Destinations, verify manually.`,
    );
    return;
  }

  const endpoint = matching[0];
  const receivesAll = endpoint.enabled_events.includes("*");
  const missing = receivesAll
    ? []
    : REQUIRED_STRIPE_EVENTS.filter(
        (e) => !endpoint.enabled_events.includes(e),
      );

  if (missing.length) {
    record(
      "Stripe webhook events",
      "fail",
      `endpoint ${endpoint.url} is missing required events: ${missing.join(", ")}`,
    );
  } else {
    record(
      "Stripe webhook events",
      "pass",
      `endpoint ${endpoint.url} subscribes to ${receivesAll ? "all events" : `${REQUIRED_STRIPE_EVENTS.length} required events`}`,
    );
  }
}

async function checkPortalWebhookRoute(appId: string) {
  const portalUrl = process.env.BILLING_APP_URL;
  if (!portalUrl) {
    record(
      "Portal webhook route",
      "warn",
      "BILLING_APP_URL not set — skipping self-check",
    );
    return;
  }
  const url = `${portalUrl.replace(/\/$/, "")}/api/billing/webhook/${appId}`;
  try {
    const res = await fetch(url, { method: "POST" });
    // The route is expected to reject unsigned requests with 400. A 404 means
    // the App row wasn't found; anything else is suspicious.
    if (res.status === 400) {
      record(
        "Portal webhook route",
        "pass",
        `${url} → 400 (missing signature — endpoint is live)`,
      );
    } else if (res.status === 404) {
      record(
        "Portal webhook route",
        "fail",
        `${url} → 404 — portal doesn't recognize appId "${appId}"`,
      );
    } else {
      record(
        "Portal webhook route",
        "warn",
        `${url} → ${res.status} (expected 400)`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record("Portal webhook route", "fail", `fetch failed: ${msg}`);
  }
}

async function checkSaasReachability() {
  const saasUrl = process.env.APP_SAAS_URL;
  if (!saasUrl) {
    record(
      "SaaS reachability",
      "warn",
      "APP_SAAS_URL not provided — skipping ping",
    );
    return;
  }
  try {
    const res = await fetch(saasUrl, {
      method: "GET",
      redirect: "manual",
    });
    // Expected "reachable" statuses. Anything else is a soft warn: a common cause
    // right after registration is that the SaaS's Secret Manager still holds the
    // OLD BILLING_API_KEY, so its billing-integrated pages fail auth (401/403)
    // or crash (500). That's a manual rotation problem, not a portal problem.
    if (res.status < 400) {
      record(
        "SaaS reachability",
        "pass",
        `${saasUrl} → ${res.status} (reachable)`,
      );
    } else if (res.status < 500) {
      record(
        "SaaS reachability",
        "warn",
        `${saasUrl} → ${res.status} (auth/permission — expected if the SaaS's BILLING_API_KEY hasn't been rotated yet)`,
      );
    } else {
      record(
        "SaaS reachability",
        "warn",
        `${saasUrl} → ${res.status} (server error — expected if the SaaS's BILLING_API_KEY hasn't been rotated yet)`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      "SaaS reachability",
      "warn",
      `fetch failed: ${msg} (SaaS may be down or unreachable from CI)`,
    );
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  const appId = process.argv[2];
  if (!appId) {
    console.error("Usage: npx tsx scripts/verify-app-registration.ts <app-id>");
    process.exit(1);
  }

  console.log(`\n🔍 Verifying registration for app "${appId}"\n`);

  const app = await checkAppRow(appId);
  if (!app) {
    printSummary();
    return;
  }

  const stripe = await checkStripeKey(app.stripeSecretKey);
  if (stripe) {
    await checkStripeWebhookEndpoints(stripe, appId);
  }

  await checkPortalWebhookRoute(appId);
  await checkSaasReachability();

  printSummary();
}

function printSummary() {
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const passes = results.filter((r) => r.status === "pass").length;
  console.log(`\n📊 Summary: ${passes} pass · ${warns} warn · ${fails} fail\n`);
  if (fails > 0) {
    console.log(
      "❌ At least one hard check failed — review before pointing traffic at this app.\n",
    );
  } else if (warns > 0) {
    console.log(
      "⚠️  Warnings above — usually safe to proceed but worth a look.\n",
    );
  } else {
    console.log("✅ All checks passed.\n");
  }

  console.log(
    "────────────────────────────────────────────────────────────────────",
  );
  console.log("🔑 Manual step remaining:");
  console.log(
    "   Copy the BILLING_API_KEY printed by create-app.ts into the SaaS's",
  );
  console.log(
    "   Secret Manager (e.g. gcloud secrets versions add BILLING_API_KEY --data-file=-)",
  );
  console.log(
    "   and redeploy the SaaS. Until you do, any SaaS-side checks above may warn.",
  );
  console.log(
    "────────────────────────────────────────────────────────────────────\n",
  );
}

main()
  .catch((err) => {
    console.error("Verification script crashed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
