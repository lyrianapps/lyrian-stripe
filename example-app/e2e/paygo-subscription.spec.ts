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
  // Filter to the div that contains *both* "Pay As You Go" text and an Upgrade
  // button — this uniquely identifies the card and avoids matching plain text
  // nodes or ancestor wrappers (strict mode violation with .first()).
  const paygoCard = page
    .locator("div")
    .filter({ has: page.getByText("Pay As You Go", { exact: true }) })
    .filter({ has: page.locator('button:has-text("Upgrade")') })
    .last();
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

  // Card number — Stripe Checkout renders card fields as regular inputs (not iframes)
  const cardNumberInput = page.getByRole("textbox", { name: "Card number" });
  await expect(cardNumberInput).toBeVisible({ timeout: 15000 });
  await cardNumberInput.fill("4242424242424242");

  const expiryInput = page.getByRole("textbox", { name: "Expiration" });
  await expiryInput.fill("1230");

  const cvcInput = page.getByRole("textbox", { name: /cvc|cvv|security/i });
  await cvcInput.fill("123");

  const cardholderInput = page.getByRole("textbox", {
    name: /cardholder name/i,
  });
  await cardholderInput.fill("Test User");

  const zipInput = page.getByRole("textbox", { name: /zip|postal/i });
  await zipInput.fill("10001");

  // Uncheck "Save my information for faster checkout" (Stripe Link) — when
  // checked it requires a phone number and blocks form submission.
  const saveLinkCheckbox = page.getByRole("checkbox", {
    name: /save my information/i,
  });
  if (await saveLinkCheckbox.isChecked().catch(() => false)) {
    await saveLinkCheckbox.uncheck();
  }

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

  // ── 5. Billing service shows success banner ───────────────────────────────
  // After the fix, Stripe → /subscription/success → /subscription?checkout_success=1&returnUrl=...
  // The billing portal must show "Subscription activated" before the user
  // navigates back to the example app.
  await page.waitForURL(/\/subscription\?.*checkout_success=1/, {
    timeout: 60000,
  });

  await expect(page.locator("text=Subscription activated")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator("text=Your payment was successful")).toBeVisible();

  await page.screenshot({
    path: path.join("e2e", "screenshots", "paygo-success-banner.png"),
    fullPage: true,
  });

  // ── 6. Follow "Back" link back to example app settings ────────────────────
  await page.click('a:has-text("Back")');
  await page.waitForURL(
    /lyrian-example-app.*\.run\.app\/settings|localhost.*\/settings/,
    { timeout: 15000 },
  );

  await page.screenshot({
    path: path.join("e2e", "screenshots", "paygo-subscribed.png"),
    fullPage: true,
  });

  console.log("✅  Paygo subscription flow complete");
});
