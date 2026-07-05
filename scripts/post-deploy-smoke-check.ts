/**
 * Post-deploy smoke check
 *
 * For every registered app, verifies the deployed billing service can:
 *   1. Serve public plan data          (GET /api/apps/:id/plans)
 *   2. Verify JWTs signed with the     (GET /api/billing/portal?token=...)
 *      secret the DB expects
 *   3. Serve subscription status with  (GET /api/subscription/status ...)
 *      the app's API key
 *
 * Catches the failure mode we've hit twice: env var / DB secret drift after a
 * deploy or key rotation, where JWTs sign fine on the SaaS side but the
 * billing service redirects everyone to /unauthorized.
 *
 * Three per-check outcomes:
 *   - PASS  — everything works
 *   - WARN  — the app is registered but a precondition is missing
 *             (no plans yet, no apiKey, no jwtSecret). Does NOT fail the
 *             workflow. This covers the "registered in stage but not prod
 *             yet" case — nothing is broken, the app just isn't fully set
 *             up in this environment.
 *   - FAIL  — a precondition is met but the deployed service can't use it.
 *             This is the drift / mis-encryption case worth failing on.
 *
 * Any side-effect rows created (BillingSession, placeholder BillingCustomer)
 * are cleaned up on both success and failure paths. The externalUserId is
 * always prefixed with `__smoke__` so any orphaned rows from crashed runs
 * are swept on the next invocation.
 *
 * Usage:
 *   DATABASE_URL=... BILLING_APP_URL=... FIELD_ENCRYPTION_KEY=... \
 *   [SAAS_JWT_SECRET=...] npx tsx scripts/prod-smoke-check.ts
 */

import "dotenv/config";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { decrypt } from "../lib/crypto";

const SMOKE_PREFIX = "__smoke__";

type Outcome = "pass" | "warn" | "fail";

interface CheckOutcome {
  outcome: Outcome;
  message?: string;
}

interface AppRow {
  id: string;
  apiKey: string | null;
  jwtSecret: string | null;
  planCount: number;
}

interface CheckResult {
  appId: string;
  plans: Outcome;
  jwt: Outcome;
  status: Outcome;
}

async function checkPlans(
  billingAppUrl: string,
  app: AppRow,
): Promise<CheckOutcome> {
  if (app.planCount === 0) {
    return {
      outcome: "warn",
      message: `No active plans registered yet — app is not fully set up in this environment`,
    };
  }

  const url = `${billingAppUrl}/api/apps/${app.id}/plans`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        outcome: "fail",
        message: `HTTP ${res.status} from ${url}`,
      };
    }
    const body = (await res.json()) as { plans?: unknown[] };
    if (!Array.isArray(body.plans) || body.plans.length === 0) {
      return {
        outcome: "fail",
        message: `DB has ${app.planCount} plan(s) but endpoint returned none — endpoint may be broken`,
      };
    }
    return { outcome: "pass" };
  } catch (err) {
    return { outcome: "fail", message: (err as Error).message };
  }
}

async function checkJwtRoundTrip(
  billingAppUrl: string,
  app: AppRow,
): Promise<CheckOutcome> {
  // Resolve the secret exactly the way the billing service does.
  const perApp = app.jwtSecret ? decrypt(app.jwtSecret) : null;
  const secret = perApp ?? process.env.SAAS_JWT_SECRET;

  if (!secret) {
    return {
      outcome: "warn",
      message: `App has no per-app jwtSecret and no SAAS_JWT_SECRET fallback — portal will reject all tokens until one is configured`,
    };
  }

  const externalUserId = `${SMOKE_PREFIX}${randomBytes(6).toString("hex")}`;
  const token = jwt.sign({ iss: app.id, sub: externalUserId }, secret, {
    expiresIn: "1m",
  });

  const url = `${billingAppUrl}/api/billing/portal?token=${token}`;

  try {
    // Do NOT follow the redirect — we only need to read the Location header.
    const res = await fetch(url, { redirect: "manual" });

    // Portal always redirects: /unauthorized on failure, /subscription on success.
    if (res.status !== 303 && res.status !== 307 && res.status !== 302) {
      return {
        outcome: "fail",
        message: `Expected redirect, got HTTP ${res.status}`,
      };
    }

    const location = res.headers.get("location") ?? "";

    if (location.includes("/unauthorized")) {
      return {
        outcome: "fail",
        message:
          `Portal redirected to /unauthorized — JWT verification failed on the deployed service.\n` +
          `        Likely causes:\n` +
          `          - App.jwtSecret in DB was encrypted with a different FIELD_ENCRYPTION_KEY\n` +
          `          - App.jwtSecret is stale and the running service has a different value\n` +
          `          - SAAS_JWT_SECRET env var on the deployed service differs from what this check used`,
      };
    }

    if (!location.includes("/subscription")) {
      return {
        outcome: "fail",
        message: `Portal redirected to unexpected location: ${location}`,
      };
    }

    return { outcome: "pass" };
  } catch (err) {
    return { outcome: "fail", message: (err as Error).message };
  }
}

async function checkStatus(
  billingAppUrl: string,
  app: AppRow,
): Promise<CheckOutcome> {
  if (!app.apiKey) {
    return {
      outcome: "warn",
      message: `App has no apiKey in DB — SaaS integrations cannot call the status endpoint yet`,
    };
  }

  const externalUserId = `${SMOKE_PREFIX}${randomBytes(6).toString("hex")}`;
  const url = `${billingAppUrl}/api/subscription/status?externalUserId=${externalUserId}`;

  try {
    const res = await fetch(url, {
      headers: { "x-api-key": app.apiKey },
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        outcome: "fail",
        message: `HTTP ${res.status} from ${url} — ${body.slice(0, 200)}`,
      };
    }
    // Any 200 (with any body shape) proves the API-key + DB lookup path works.
    return { outcome: "pass" };
  } catch (err) {
    return { outcome: "fail", message: (err as Error).message };
  }
}

async function cleanupSmokeRows(): Promise<void> {
  // Sessions first (FK to BillingCustomer)
  const sessions = await prisma.billingSession.deleteMany({
    where: { externalUserId: { startsWith: SMOKE_PREFIX } },
  });
  const customers = await prisma.billingCustomer.deleteMany({
    where: { externalUserId: { startsWith: SMOKE_PREFIX } },
  });
  if (sessions.count > 0 || customers.count > 0) {
    console.log(
      `\nCleaned up ${sessions.count} session(s) and ${customers.count} customer(s) with '${SMOKE_PREFIX}' prefix.`,
    );
  }
}

function symbol(outcome: Outcome): string {
  return outcome === "pass"
    ? "PASS ✓"
    : outcome === "warn"
      ? "WARN ⚠"
      : "FAIL ✗";
}

async function main() {
  const billingAppUrl = process.env.BILLING_APP_URL;
  if (!billingAppUrl) {
    console.error("Error: BILLING_APP_URL is not set");
    process.exit(1);
  }

  const rawApps = await prisma.app.findMany({
    select: {
      id: true,
      apiKey: true,
      jwtSecret: true,
      _count: {
        select: { plans: { where: { isActive: true } } },
      },
    },
    orderBy: { id: "asc" },
  });

  const apps: AppRow[] = rawApps.map((a) => ({
    id: a.id,
    apiKey: a.apiKey,
    jwtSecret: a.jwtSecret,
    planCount: a._count.plans,
  }));

  if (apps.length === 0) {
    console.warn("No apps found in DB — skipping smoke check.");
    process.exit(0);
  }

  console.log(`Running smoke checks against ${billingAppUrl}`);
  console.log(`Checking ${apps.length} app(s)...\n`);

  const results: CheckResult[] = [];

  for (const app of apps) {
    console.log(`[${app.id}]`);

    const plansResult = await checkPlans(billingAppUrl, app);
    console.log(`  Plans endpoint:     ${symbol(plansResult.outcome)}`);
    if (plansResult.message) console.log(`      → ${plansResult.message}`);

    const jwtResult = await checkJwtRoundTrip(billingAppUrl, app);
    console.log(`  JWT round-trip:     ${symbol(jwtResult.outcome)}`);
    if (jwtResult.message) console.log(`      → ${jwtResult.message}`);

    const statusResult = await checkStatus(billingAppUrl, app);
    console.log(`  Status endpoint:    ${symbol(statusResult.outcome)}`);
    if (statusResult.message) console.log(`      → ${statusResult.message}`);

    console.log("");
    results.push({
      appId: app.id,
      plans: plansResult.outcome,
      jwt: jwtResult.outcome,
      status: statusResult.outcome,
    });
  }

  // Best-effort cleanup — never fail the workflow because of this.
  try {
    await cleanupSmokeRows();
  } catch (err) {
    console.warn(
      `Cleanup skipped: ${(err as Error).message}. Orphaned rows will be swept on the next run.`,
    );
  }

  const failed = results.filter(
    (r) => r.plans === "fail" || r.jwt === "fail" || r.status === "fail",
  );
  const warned = results.filter(
    (r) =>
      r.plans !== "fail" &&
      r.jwt !== "fail" &&
      r.status !== "fail" &&
      (r.plans === "warn" || r.jwt === "warn" || r.status === "warn"),
  );
  const passed = results.filter(
    (r) => r.plans === "pass" && r.jwt === "pass" && r.status === "pass",
  );

  console.log("─".repeat(60));
  console.log(
    `Summary: ${passed.length} passed, ${warned.length} warnings, ${failed.length} failed`,
  );

  if (warned.length > 0) {
    console.log(`\nApps with warnings (not fully set up in this env):`);
    for (const r of warned) {
      console.log(`  - ${r.appId}`);
    }
  }

  if (failed.length > 0) {
    console.error(`\nApps that FAILED:`);
    for (const r of failed) {
      console.error(`  - ${r.appId}`);
    }
    console.error(
      `\nDeploy will be marked as failed. Investigate the FAIL lines above.`,
    );
    process.exit(1);
  }

  console.log(`\nAll critical checks passed ✓`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
