/**
 * E2E: Pay As You Go subscription flow
 *
 * 1. Register a new account with billing type "metered" (Pay as You Go)
 * 2. Navigate to Settings
 * 3. Click "Upgrade →" on the paygo plan card
 * 4. Complete Stripe test checkout (card 4242 4242 4242 4242)
 * 5. Get redirected back to /settings
 * 6. Screenshot the final state
 */
import { test, expect } from "@playwright/test";
import path from "path";

const TEST_PASSWORD = "test1234";

function uniqueEmail() {
  return `paygo-test-${Date.now()}@example.com`;
}

test("register → paygo upgrade → redirected back to settings", async ({
  page,
}) => {
  const testEmail = uniqueEmail();

  // ── 1. Register ────────────────────────────────────────────────────────────
  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();

  // Email & password
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', TEST_PASSWORD);

  // Select "Pay as You Go" billing type
  await page.click('button:has-text("Pay as You Go")');
  // Verify selection via class (Tailwind v4 uses oklab, not rgb)
  await expect(page.locator('button:has-text("Pay as You Go")')).toHaveClass(
    /border-blue-500/,
  );

  // Submit registration
  await page.click('button[type="submit"]:has-text("Create account")');

  // Should land on home (todo list)
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // ── 2. Navigate to Settings ────────────────────────────────────────────────
  await page.goto("/settings");
  await expect(page).toHaveURL("/settings", { timeout: 10000 });
  await expect(page.locator("text=Available Plans")).toBeVisible({
    timeout: 10000,
  });

  // ── 3. Click Upgrade on the paygo plan card ────────────────────────────────
  // Find the Pay As You Go card by its plan name
  const paygoCard = page
    .locator("div")
    .filter({ hasText: "Pay As You Go" })
    .first();
  await expect(paygoCard).toBeVisible({ timeout: 10000 });

  const upgradeButton = paygoCard.locator('button:has-text("Upgrade")');
  await upgradeButton.click();

  // ── 4. Stripe checkout ─────────────────────────────────────────────────────
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

  await page.screenshot({
    path: path.join("e2e", "screenshots", "stripe-checkout.png"),
    fullPage: true,
  });

  // Stripe hosted checkout: fill card details
  // Email may already be pre-filled from registration; fill if empty
  const emailInput = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const currentVal = await emailInput.inputValue().catch(() => "");
    if (!currentVal) {
      await emailInput.fill(testEmail);
    }
  }

  // Card number — Stripe renders card fields in iframes
  // Try the unified "Payment" iframe first, fall back to individual field iframes
  const cardNumberFrame = page.frameLocator(
    'iframe[title="Secure card number input frame"]',
  );
  const expiryFrame = page.frameLocator(
    'iframe[title="Secure expiry date input frame"]',
  );
  const cvcFrame = page.frameLocator('iframe[title="Secure CVC input frame"]');

  await cardNumberFrame.locator("input").fill("4242424242424242");
  await expiryFrame.locator("input").fill("1230");
  await cvcFrame.locator("input").fill("123");

  await page.screenshot({
    path: path.join("e2e", "screenshots", "stripe-checkout-filled.png"),
    fullPage: true,
  });

  // Submit the checkout form
  const submitButton = page
    .locator(
      'button[type="submit"], button:has-text("Subscribe"), button:has-text("Start"), button:has-text("Pay")',
    )
    .first();
  await expect(submitButton).toBeEnabled({ timeout: 5000 });
  await submitButton.click();

  // ── 5. Redirected back to /settings ───────────────────────────────────────
  await page.waitForURL(
    /lyrian-example-app.*\.run\.app\/settings|localhost.*\/settings/,
    { timeout: 60000 },
  );

  // Subscription should now be active (status badge)
  await expect(page.locator("text=active, text=trialing").first()).toBeVisible({
    timeout: 10000,
  });

  // ── 6. Screenshot ─────────────────────────────────────────────────────────
  await page.screenshot({
    path: path.join("e2e", "screenshots", "paygo-subscribed.png"),
    fullPage: true,
  });

  console.log("✅  Screenshot saved: e2e/screenshots/paygo-subscribed.png");
});
