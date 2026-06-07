/**
 * E2E: Billing mode plan filtering
 *
 * Verifies that the Settings page shows only the plans that match the
 * billing mode the user chose at registration:
 *
 *   flat_rate  →  Basic + Pro visible, Pay As You Go hidden
 *   metered    →  Pay As You Go visible, Basic + Pro hidden
 *
 * No Stripe checkout is performed — these are UI-only assertions on the
 * /settings page rendered for a freshly registered free-trial user.
 */
import { test, expect, type Page } from "@playwright/test";

const TEST_PASSWORD = "test1234";

function uniqueEmail(tag: string) {
  return `billing-mode-${tag}-${Date.now()}@example.com`;
}

// ── Helper: register a new user with the given billing type ───────────────────

async function registerUser(
  page: Page,
  email: string,
  billingType: "flat_rate" | "metered",
) {
  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);

  if (billingType === "metered") {
    await page.click('button:has-text("Pay as You Go")');
    await expect(page.locator('button:has-text("Pay as You Go")')).toHaveClass(
      /border-blue-500/,
    );
  } else {
    // flat_rate is selected by default — verify it
    await expect(page.locator('button:has-text("Subscription")')).toHaveClass(
      /border-blue-500/,
    );
  }

  await page.click('button[type="submit"]:has-text("Create account")');
  await page.waitForURL("/", { timeout: 15000 });
}

// ── flat_rate mode ────────────────────────────────────────────────────────────

test("flat_rate mode: Settings shows only subscription plans (Basic + Pro)", async ({
  page,
}) => {
  const email = uniqueEmail("flat");
  await registerUser(page, email, "flat_rate");

  await page.goto("/settings");
  await expect(page.locator("text=Available Plans")).toBeVisible({
    timeout: 10000,
  });

  // Subscription plans visible
  await expect(page.getByText("Basic", { exact: true })).toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();

  // Metered plan NOT visible
  await expect(
    page.getByText("Pay As You Go", { exact: true }),
  ).not.toBeVisible();

  // Price format is flat-rate ($/mo), not usage-based
  await expect(page.getByText("$10.00 / mo")).toBeVisible();
  await expect(page.getByText("$30.00 / mo")).toBeVisible();
  await expect(page.getByText("Usage-based")).not.toBeVisible();
});

// ── metered mode ──────────────────────────────────────────────────────────────

test("metered mode: Settings shows only Pay As You Go plan", async ({
  page,
}) => {
  const email = uniqueEmail("metered");
  await registerUser(page, email, "metered");

  await page.goto("/settings");
  await expect(page.locator("text=Available Plans")).toBeVisible({
    timeout: 10000,
  });

  // Metered plan visible
  await expect(page.getByText("Pay As You Go", { exact: true })).toBeVisible();

  // Subscription plans NOT visible
  await expect(page.getByText("Basic", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).not.toBeVisible();

  // Price format is usage-based
  await expect(page.getByText("Usage-based")).toBeVisible();
  await expect(page.getByText("$10.00 / mo")).not.toBeVisible();
});

// ── billing portal /subscription page ────────────────────────────────────────

test("billing portal: billingType=flat_rate param shows subscription plans only", async ({
  page,
}) => {
  const email = uniqueEmail("portal-flat");
  await registerUser(page, email, "flat_rate");

  // Visit portal-redirect to get a billing_session cookie and land on /subscription
  await page.goto("/api/billing/portal-redirect");
  await page.waitForURL(/\/subscription/, { timeout: 20000 });

  const url = new URL(page.url());
  // The portal-redirect should have included billingType=flat_rate in the URL
  expect(url.searchParams.get("billingType")).toBe("flat_rate");

  // Subscription plans visible
  await expect(page.getByText("Basic", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Pro", { exact: true })).toBeVisible();

  // Metered plan NOT visible
  await expect(
    page.getByText("Pay As You Go", { exact: true }),
  ).not.toBeVisible();

  // Banner reflects subscription billing
  await expect(page.getByText("Subscription billing")).toBeVisible();
  await expect(page.getByText("Usage-based billing")).not.toBeVisible();
});

test("billing portal: billingType=metered param shows metered plans only", async ({
  page,
}) => {
  const email = uniqueEmail("portal-metered");
  await registerUser(page, email, "metered");

  // Visit portal-redirect to get a billing_session cookie and land on /subscription
  await page.goto("/api/billing/portal-redirect");
  await page.waitForURL(/\/subscription/, { timeout: 20000 });

  const url = new URL(page.url());
  // The portal-redirect should have included billingType=metered in the URL
  expect(url.searchParams.get("billingType")).toBe("metered");

  // Metered plan visible
  await expect(page.getByText("Pay As You Go", { exact: true })).toBeVisible({
    timeout: 10000,
  });

  // Subscription plans NOT visible
  await expect(page.getByText("Basic", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Pro", { exact: true })).not.toBeVisible();

  // Banner reflects usage-based billing
  await expect(page.getByText("Usage-based billing")).toBeVisible();
  await expect(page.getByText("Subscription billing")).not.toBeVisible();
});
