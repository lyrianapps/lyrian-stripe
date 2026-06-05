/**
 * E2E: Pay As You Go checkout — real Stripe decline cards
 *
 * These tests use Stripe's official test decline card numbers to exercise the
 * full end-to-end path WITHOUT any test-mode shortcuts:
 *
 *   example app /settings
 *     → POST /api/billing/checkout  (example app proxies to billing service)
 *     → checkout.stripe.com         (Stripe hosted checkout, real card input)
 *     → billing /subscription/success?session_id=...  (Stripe redirects here)
 *     → billing service calls stripe.checkout.sessions.retrieve(sessionId)
 *     → reads payment_status=unpaid + decline_code from payment_intent
 *     → redirects to /subscription?checkout_declined=<code>&returnUrl=...
 *     → correct banner shown on billing portal subscription page
 *
 * Stripe test decline cards (https://stripe.com/docs/testing#declined-payments):
 *   4000000000009987  → card_declined / lost_card
 *   4000000000009979  → card_declined / stolen_card
 *   4000000000009995  → card_declined / insufficient_funds
 *   4000000000000002  → card_declined / generic_decline
 *
 * Note: "fraudulent" decline code comes from Stripe Radar rules, not card
 * number — not testable via checkout. It is covered in paygo-checkout-banners
 * via _test_decline_code shortcut instead.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const TEST_PASSWORD = "test1234";

function uniqueEmail(tag: string) {
  return `paygo-decline-${tag}-${Date.now()}@example.com`;
}

/**
 * Registers a new user, navigates to /settings, clicks Upgrade on the
 * Pay As You Go card, and waits for Stripe checkout to load.
 *
 * Returns the test email (used to pre-fill checkout if Stripe prompts for it).
 */
async function registerAndStartCheckout(
  page: Page,
  emailTag: string,
): Promise<string> {
  const email = uniqueEmail(emailTag);

  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button:has-text("Pay as You Go")');
  await page.click('button[type="submit"]:has-text("Create account")');
  await page.waitForURL("/", { timeout: 15000 });

  await page.goto("/settings");
  await expect(page.locator("text=Available Plans")).toBeVisible({
    timeout: 10000,
  });

  const paygoCard = page
    .locator("div")
    .filter({ hasText: "Pay As You Go" })
    .first();
  await expect(paygoCard).toBeVisible({ timeout: 10000 });
  await paygoCard.locator('button:has-text("Upgrade")').click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

  return email;
}

/**
 * Fills and submits the Stripe checkout form with the given card number.
 * Handles optional email pre-fill.
 */
async function fillAndSubmitCheckout(
  page: Page,
  cardNumber: string,
  email: string,
) {
  // Fill email if Stripe prompts for it
  const emailInput = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const val = await emailInput.inputValue().catch(() => "");
    if (!val) await emailInput.fill(email);
  }

  const cardNumberInput = page.getByRole("textbox", { name: "Card number" });
  await expect(cardNumberInput).toBeVisible({ timeout: 15000 });
  await cardNumberInput.fill(cardNumber);

  await page.getByRole("textbox", { name: "Expiration" }).fill("1230");
  await page.getByRole("textbox", { name: /cvc|cvv|security/i }).fill("123");
  await page
    .getByRole("textbox", { name: /cardholder name/i })
    .fill("Test User");
  await page.getByRole("textbox", { name: /zip|postal/i }).fill("10001");

  await page.screenshot({
    path: path.join(
      "e2e",
      "screenshots",
      `stripe-decline-filled-${cardNumber.slice(-4)}.png`,
    ),
    fullPage: true,
  });

  const submitButton = page
    .locator(
      'button[type="submit"], button:has-text("Subscribe"), button:has-text("Start"), button:has-text("Pay")',
    )
    .first();
  await expect(submitButton).toBeEnabled({ timeout: 5000 });
  await submitButton.click();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Paygo checkout — real Stripe decline cards", () => {
  test("lost card (4000000000009987) → shows 'Card reported lost' banner", async ({
    page,
  }) => {
    const email = await registerAndStartCheckout(page, "lost-card");

    await fillAndSubmitCheckout(page, "4000000000009987", email);

    // Stripe → /subscription/success → /subscription?checkout_declined=lost_card
    await page.waitForURL(/\/subscription\?.*checkout_declined=lost_card/, {
      timeout: 60000,
    });

    await expect(page.locator("text=Card reported lost")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as lost")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "decline-lost-card.png"),
      fullPage: true,
    });
  });

  test("stolen card (4000000000009979) → shows 'Card reported stolen' banner", async ({
    page,
  }) => {
    const email = await registerAndStartCheckout(page, "stolen-card");

    await fillAndSubmitCheckout(page, "4000000000009979", email);

    await page.waitForURL(/\/subscription\?.*checkout_declined=stolen_card/, {
      timeout: 60000,
    });

    await expect(page.locator("text=Card reported stolen")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as stolen")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "decline-stolen-card.png"),
      fullPage: true,
    });
  });

  test("insufficient funds (4000000000009995) → shows 'Insufficient funds' banner", async ({
    page,
  }) => {
    const email = await registerAndStartCheckout(page, "insufficient-funds");

    await fillAndSubmitCheckout(page, "4000000000009995", email);

    await page.waitForURL(
      /\/subscription\?.*checkout_declined=insufficient_funds/,
      { timeout: 60000 },
    );

    await expect(page.locator("text=Insufficient funds")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=insufficient funds")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "decline-insufficient-funds.png"),
      fullPage: true,
    });
  });

  test("generic decline (4000000000000002) → shows 'Card declined' fallback banner", async ({
    page,
  }) => {
    const email = await registerAndStartCheckout(page, "generic-decline");

    await fillAndSubmitCheckout(page, "4000000000000002", email);

    // generic_decline is not in DECLINE_MESSAGES so falls through to fallback
    await page.waitForURL(/\/subscription\?.*checkout_declined=/, {
      timeout: 60000,
    });

    await expect(page.locator("text=Card declined")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=declined or flagged")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "decline-generic.png"),
      fullPage: true,
    });
  });
});
