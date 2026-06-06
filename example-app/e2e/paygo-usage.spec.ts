/**
 * E2E: Pay As You Go — usage meter display
 *
 * Tests that the usage counter, estimated cost, and billing portal plan info
 * are correctly displayed for an active paygo subscriber.
 *
 * Strategy:
 *   1. Register a new user on the example app.
 *   2. Open the billing portal so billing_session cookie is set.
 *   3. Call e2e-setup to inject an active paygo subscription (shortcut —
 *      no real Stripe checkout needed) with a pre-seeded usage count.
 *   4. Verify the settings page shows the seeded usage + estimated cost.
 *   5. Create additional todos via the UI and verify the counter increments.
 *   6. Verify the billing portal shows "Current Plan: Pay As You Go".
 *
 * afterAll: clean up all billing data created during the run via e2e-cleanup.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const TEST_PASSWORD = "test1234";
const BILLING_APP_ID = "example_app";

function uniqueEmail(tag: string) {
  return `paygo-usage-${tag}-${Date.now()}@example.com`;
}

// Track user IDs created in this file for cleanup
const createdUserIds: string[] = [];
let billingOriginGlobal = "";

async function registerAndSetupPaygo(
  page: Page,
  emailTag: string,
  seedUsageCount = 0,
  periodStartDaysAgo = 15,
): Promise<{ userId: string; billingOrigin: string }> {
  const email = uniqueEmail(emailTag);

  // Register as metered (Pay as You Go) user
  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  // Select Pay as You Go billing type so session has billingType=metered
  await page.click('button:has-text("Pay as You Go")');
  await page.click('button[type="submit"]:has-text("Create account")');
  await page.waitForURL("/", { timeout: 15000 });

  // Read userId from localStorage
  const userId = await page.evaluate<string>(() => {
    const users = JSON.parse(
      localStorage.getItem("lyrian_users") ?? "[]",
    ) as Array<{ userId: string }>;
    return users[users.length - 1]?.userId ?? "";
  });

  // Open billing portal to get billing_session cookie
  await page.goto("/api/billing/portal-redirect");
  await page.waitForURL(/\/subscription/, { timeout: 20000 });
  const billingOrigin = new URL(page.url()).origin;

  // Inject active paygo subscription + pre-seeded usage via e2e-setup
  const setupRes = await page.request.post(
    `${billingOrigin}/api/dev/e2e-setup`,
    {
      data: {
        appId: BILLING_APP_ID,
        externalUserId: userId,
        plan: "paygo",
        seedUsageCount,
        periodStartDaysAgo,
      },
    },
  );
  if (!setupRes.ok()) {
    throw new Error(
      `e2e-setup failed: ${setupRes.status()} ${await setupRes.text()}`,
    );
  }

  createdUserIds.push(userId);
  billingOriginGlobal = billingOrigin;

  return { userId, billingOrigin };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Paygo — usage meter display", () => {
  test("settings page shows seeded usage count and estimated cost", async ({
    page,
  }) => {
    const SEED_COUNT = 5;

    await registerAndSetupPaygo(page, "seeded", SEED_COUNT, 15);

    await page.goto("/settings");
    await expect(page).toHaveURL("/settings", { timeout: 10000 });

    await page.screenshot({
      path: path.join("e2e", "screenshots", "usage-01-settings-seeded.png"),
      fullPage: true,
    });

    // The metered usage count lives in a span.text-2xl (unique on this page).
    // Using span.text-2xl avoids strict-mode violations caused by the email
    // in the navbar whose timestamp substring may contain the seed digit.
    await expect(page.locator("text=todos this month")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("span.text-2xl")).toHaveText(String(SEED_COUNT));

    // Estimated cost: 5 × $0.04 = $0.20
    await expect(page.locator("text=0.20")).toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "usage-02-settings-with-cost.png"),
      fullPage: true,
    });
  });

  test("creating todos increments the usage counter", async ({ page }) => {
    const SEED_COUNT = 3;
    await registerAndSetupPaygo(page, "increment", SEED_COUNT, 15);

    await page.goto("/settings");
    await expect(page.locator("text=todos this month")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("span.text-2xl")).toHaveText(String(SEED_COUNT));

    // Create 2 todos via the home page
    await page.goto("/");
    await expect(page).toHaveURL("/", { timeout: 10000 });

    const todoInput = page
      .locator(
        'input[placeholder*="todo"], input[placeholder*="Todo"], input[type="text"]',
      )
      .first();
    await expect(todoInput).toBeVisible({ timeout: 10000 });

    await todoInput.fill("Usage test todo 1");
    // Wait for React to commit the onChange state update before submitting,
    // otherwise handleAdd reads newText="" and short-circuits (no POST made).
    await expect(todoInput).toHaveValue("Usage test todo 1", { timeout: 3000 });
    await page.click('button[type="submit"]');
    // Metered users hit Stripe's meter API on each todo — allow extra time
    await expect(page.locator("text=Usage test todo 1")).toBeVisible({
      timeout: 20000,
    });
    // Wait for input to clear (submit handler sets newText="") before next todo
    await expect(todoInput).toHaveValue("", { timeout: 10000 });

    await todoInput.fill("Usage test todo 2");
    await expect(todoInput).toHaveValue("Usage test todo 2", { timeout: 3000 });
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Usage test todo 2")).toBeVisible({
      timeout: 20000,
    });
    await expect(todoInput).toHaveValue("", { timeout: 10000 });

    await page.screenshot({
      path: path.join("e2e", "screenshots", "usage-03-todos-created.png"),
      fullPage: true,
    });

    // Counter should now be seeded + 2
    await page.goto("/settings");
    const expectedCount = SEED_COUNT + 2;
    await expect(page.locator("text=todos this month")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("span.text-2xl")).toHaveText(
      String(expectedCount),
    );

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "usage-04-settings-after-todos.png",
      ),
      fullPage: true,
    });
  });

  test("billing portal shows Pay As You Go as current plan", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndSetupPaygo(
      page,
      "portal-plan",
      2,
      15,
    );

    await page.goto(`${billingOrigin}/subscription`);
    await expect(page.locator("h1")).toContainText("Subscription");

    // Current plan should be paygo after e2e-setup
    await expect(page.locator("text=Pay As You Go")).toBeVisible({
      timeout: 10000,
    });

    // Billing mode indicator should show usage-based
    await expect(page.locator("text=Usage-based billing")).toBeVisible();

    // Upgrade button should NOT appear since the user is already on paygo
    await expect(page.locator('button:has-text("Upgrade")')).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "usage-05-portal-paygo-plan.png"),
      fullPage: true,
    });
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

test.afterAll(async ({ request }) => {
  if (!billingOriginGlobal) return;
  for (const userId of createdUserIds) {
    try {
      await request.post(`${billingOriginGlobal}/api/dev/e2e-cleanup`, {
        data: { appId: BILLING_APP_ID, externalUserId: userId },
      });
    } catch {
      // Best-effort — don't fail the suite on cleanup errors
    }
  }
});
