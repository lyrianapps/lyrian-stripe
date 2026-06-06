/**
 * E2E: Billing portal — declined card & duplicate card checkout scenarios
 *
 * Full flow for each decline scenario:
 *   1. Register a paygo user on the example app
 *   2. Go to Settings → click "Upgrade →" on the Pay As You Go plan card
 *   3. Land on Stripe Checkout (checkout.stripe.com)
 *   4. Fill form with a Stripe test decline card & submit
 *   5. Screenshot the Stripe-side error message
 *   6. Navigate through the billing service's success page (using _test params
 *      to simulate the payment_status Stripe would send in an async decline)
 *   7. Assert the correct banner on /subscription
 *
 * Duplicate card detection is webhook-driven (payment_method.attached fires
 * when a card fingerprint is already on file). The e2e-setup endpoint is used
 * to set the flag directly, mirroring the real webhook path.
 *
 * Stripe test decline cards:
 *   4000000000009987 — card_declined (generic)
 *   4000000000009979 — card_declined, insufficient_funds
 *   4100000000000019 — card_declined, fraudulent
 *   4000000000005126 — card_declined, lost_card
 *   4000000000009235 — card_declined, stolen_card
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const TEST_PASSWORD = "test1234";
const BILLING_APP_ID = "example_app";
const APP_URL =
  process.env.BASE_URL ??
  "https://lyrian-example-app-494926016713.us-central1.run.app";

const createdUserIds: string[] = [];
let billingOriginGlobal = "";

function uniqueEmail(tag: string) {
  return `decline-${tag}-${Date.now()}@example.com`;
}

// ─── Helper: register → settings → click Upgrade → land on Stripe checkout ──

/**
 * Registers a fresh paygo user, establishes a billing_session cookie by
 * visiting the portal redirect, then navigates to /settings and clicks
 * the Upgrade button on the Pay As You Go plan card.
 *
 * Caller lands on checkout.stripe.com ready to fill card details.
 */
async function registerAndStartCheckout(
  page: Page,
  emailTag: string,
): Promise<{ email: string; userId: string; billingOrigin: string }> {
  const email = uniqueEmail(emailTag);

  // ── 1. Register ───────────────────────────────────────────────────────────
  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  // Select Pay as You Go billing type
  await page.click('button:has-text("Pay as You Go")');
  await page.click('button[type="submit"]:has-text("Create account")');
  await page.waitForURL("/", { timeout: 15000 });

  const userId = await page.evaluate<string>(() => {
    const users = JSON.parse(
      localStorage.getItem("lyrian_users") ?? "[]",
    ) as Array<{ userId: string }>;
    return users[users.length - 1]?.userId ?? "";
  });

  // ── 2. Establish billing_session before checkout ──────────────────────────
  // billing_session must exist on the billing domain so /subscription renders
  // correctly when Stripe redirects back after payment.
  await page.goto("/api/billing/portal-redirect");
  await page.waitForURL(/\/subscription/, { timeout: 20000 });
  const billingOrigin = new URL(page.url()).origin;
  billingOriginGlobal = billingOrigin;
  createdUserIds.push(userId);

  // ── 3. Navigate to Settings ───────────────────────────────────────────────
  await page.goto("/settings");
  await expect(page.locator("text=Available Plans")).toBeVisible({
    timeout: 10000,
  });

  // ── 4. Click Upgrade on the Pay As You Go plan card ───────────────────────
  const paygoCard = page
    .locator("div")
    .filter({ has: page.getByText("Pay As You Go", { exact: true }) })
    .filter({ has: page.locator('button:has-text("Upgrade")') })
    .last();
  await expect(paygoCard).toBeVisible({ timeout: 10000 });
  await paygoCard.locator('button:has-text("Upgrade")').click();

  // ── 5. Wait for Stripe Checkout ───────────────────────────────────────────
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });

  return { email, userId, billingOrigin };
}

/**
 * Fill the common Stripe Checkout form fields with a given card number.
 * Waits for the card number input to appear (Stripe can be slow on first load).
 */
async function fillStripeCheckout(
  page: Page,
  cardNumber: string,
  email: string,
) {
  const cardInput = page.getByRole("textbox", { name: "Card number" });
  await expect(cardInput).toBeVisible({ timeout: 45000 });

  // Pre-fill email only if Stripe didn't auto-populate it
  const emailInput = page
    .locator('input[type="email"], input[name="email"]')
    .first();
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const current = await emailInput.inputValue().catch(() => "");
    if (!current) await emailInput.fill(email);
  }

  await cardInput.fill(cardNumber);
  await page.getByRole("textbox", { name: "Expiration" }).fill("1230");
  await page.getByRole("textbox", { name: /cvc|cvv|security/i }).fill("123");

  const cardholderInput = page.getByRole("textbox", {
    name: /cardholder name/i,
  });
  if (await cardholderInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cardholderInput.fill("Test User");
  }

  const zipInput = page.getByRole("textbox", { name: /zip|postal/i });
  if (await zipInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await zipInput.fill("10001");
  }

  // Uncheck Stripe Link "save my info" to avoid phone number prompts
  const saveLinkCheckbox = page.getByRole("checkbox", {
    name: /save my information/i,
  });
  if (await saveLinkCheckbox.isChecked().catch(() => false)) {
    await saveLinkCheckbox.uncheck();
  }
}

/**
 * Click the checkout submit button (label varies by plan type).
 */
async function submitCheckout(page: Page) {
  const submitButton = page
    .locator(
      'button[type="submit"], button:has-text("Subscribe"), button:has-text("Start"), button:has-text("Pay")',
    )
    .first();
  await expect(submitButton).toBeEnabled({ timeout: 5000 });
  await submitButton.click();
}

// ─── Declined card — full checkout flow ──────────────────────────────────────

test.describe("Declined card — full checkout flow", () => {
  // ── Lost card ───────────────────────────────────────────────────────────────
  test("lost card: Stripe error → billing banner 'Card reported lost'", async ({
    page,
  }) => {
    const { email, billingOrigin } = await registerAndStartCheckout(
      page,
      "lost",
    );
    const returnUrl = `${APP_URL}/settings`;

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-lost-01-stripe-checkout-empty.png",
      ),
      fullPage: true,
    });

    // Fill with the lost-card test number
    await fillStripeCheckout(page, "4000000000005126", email);

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-lost-02-stripe-form-filled.png",
      ),
      fullPage: true,
    });

    await submitCheckout(page);

    // Stripe shows an inline error — user stays on checkout.stripe.com
    await expect(page.getByText(/your card was reported lost/i)).toBeVisible({
      timeout: 30000,
    });

    await page.screenshot({
      path: path.join("e2e", "screenshots", "decline-lost-03-stripe-error.png"),
      fullPage: true,
    });

    // Navigate through the billing success page (simulates Stripe's async
    // payment_status=unpaid redirect + the billing service's success-page logic)
    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=cs_test_e2e_lost&_test_payment_status=unpaid` +
        `&_test_decline_code=lost_card` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=lost_card/,
    );

    await expect(page.locator("text=Card reported lost")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as lost")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-lost-04-billing-banner.png",
      ),
      fullPage: true,
    });
  });

  // ── Stolen card ─────────────────────────────────────────────────────────────
  test("stolen card: Stripe error → billing banner 'Card reported stolen'", async ({
    page,
  }) => {
    const { email, billingOrigin } = await registerAndStartCheckout(
      page,
      "stolen",
    );
    const returnUrl = `${APP_URL}/settings`;

    await fillStripeCheckout(page, "4000000000009235", email);

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-stolen-01-stripe-form-filled.png",
      ),
      fullPage: true,
    });

    await submitCheckout(page);

    await expect(page.getByText(/your card was reported stolen/i)).toBeVisible({
      timeout: 30000,
    });

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-stolen-02-stripe-error.png",
      ),
      fullPage: true,
    });

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=cs_test_e2e_stolen&_test_payment_status=unpaid` +
        `&_test_decline_code=stolen_card` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=stolen_card/,
    );

    await expect(page.locator("text=Card reported stolen")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as stolen")).toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-stolen-03-billing-banner.png",
      ),
      fullPage: true,
    });
  });

  // ── Fraudulent card ─────────────────────────────────────────────────────────
  test("fraudulent card: Stripe error → billing banner 'Transaction flagged'", async ({
    page,
  }) => {
    const { email, billingOrigin } = await registerAndStartCheckout(
      page,
      "fraud",
    );
    const returnUrl = `${APP_URL}/settings`;

    await fillStripeCheckout(page, "4100000000000019", email);

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-fraud-01-stripe-form-filled.png",
      ),
      fullPage: true,
    });

    await submitCheckout(page);

    // Stripe shows a generic "Your card was declined." for fraudulent cards
    await expect(page.getByText(/your card was declined/i)).toBeVisible({
      timeout: 30000,
    });

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-fraud-02-stripe-error.png",
      ),
      fullPage: true,
    });

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=cs_test_e2e_fraud&_test_payment_status=unpaid` +
        `&_test_decline_code=fraudulent` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=fraudulent/,
    );

    await expect(page.locator("text=Transaction flagged")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=flagged as suspicious")).toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-fraud-03-billing-banner.png",
      ),
      fullPage: true,
    });
  });

  // ── Insufficient funds ──────────────────────────────────────────────────────
  test("insufficient funds: Stripe error → billing banner 'Insufficient funds'", async ({
    page,
  }) => {
    const { email, billingOrigin } = await registerAndStartCheckout(
      page,
      "insuf",
    );
    const returnUrl = `${APP_URL}/settings`;

    await fillStripeCheckout(page, "4000000000009979", email);

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-insuf-01-stripe-form-filled.png",
      ),
      fullPage: true,
    });

    await submitCheckout(page);

    await expect(page.getByText(/insufficient funds/i)).toBeVisible({
      timeout: 30000,
    });

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-insuf-02-stripe-error.png",
      ),
      fullPage: true,
    });

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=cs_test_e2e_insuf&_test_payment_status=unpaid` +
        `&_test_decline_code=insufficient_funds` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=insufficient_funds/,
    );

    await expect(
      page.getByText("Insufficient funds", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=add funds to your account")).toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-insuf-03-billing-banner.png",
      ),
      fullPage: true,
    });
  });

  // ── Generic decline ─────────────────────────────────────────────────────────
  test("generic decline: Stripe error → billing banner 'Card declined'", async ({
    page,
  }) => {
    const { email, billingOrigin } = await registerAndStartCheckout(
      page,
      "generic",
    );
    const returnUrl = `${APP_URL}/settings`;

    await fillStripeCheckout(page, "4000000000009987", email);

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-generic-01-stripe-form-filled.png",
      ),
      fullPage: true,
    });

    await submitCheckout(page);

    await expect(page.getByText(/your card was declined/i)).toBeVisible({
      timeout: 30000,
    });

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-generic-02-stripe-error.png",
      ),
      fullPage: true,
    });

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=cs_test_e2e_generic&_test_payment_status=unpaid` +
        `&_test_decline_code=do_not_honor` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    await expect(page).toHaveURL(/\/subscription\?.*checkout_declined=/);

    await expect(page.locator("text=Card declined")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=declined or flagged")).toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "decline-generic-03-billing-banner.png",
      ),
      fullPage: true,
    });
  });
});

// ─── Duplicate card detection ─────────────────────────────────────────────────
//
// Duplicate detection fires via the payment_method.attached Stripe webhook
// when a card fingerprint is already on file for the app. The e2e-setup
// endpoint sets the flag directly, mirroring the real webhook path.

test.describe("Duplicate card detection — full flow", () => {
  async function setDuplicateCardFlag(
    page: Page,
    billingOrigin: string,
    userId: string,
  ) {
    const res = await page.request.post(`${billingOrigin}/api/dev/e2e-setup`, {
      data: {
        appId: BILLING_APP_ID,
        externalUserId: userId,
        duplicateCardDetected: true,
      },
    });
    if (!res.ok()) {
      throw new Error(`e2e-setup failed: ${res.status()} ${await res.text()}`);
    }
  }

  test("duplicate card detected: banner shows 'Card already on file' on next portal visit", async ({
    page,
  }) => {
    const { email, userId, billingOrigin } = await registerAndStartCheckout(
      page,
      "dup",
    );

    // Screenshot the Stripe checkout page (showing the card form)
    const cardInput = page.getByRole("textbox", { name: "Card number" });
    await expect(cardInput).toBeVisible({ timeout: 45000 });

    await page.screenshot({
      path: path.join("e2e", "screenshots", "dup-card-01-stripe-checkout.png"),
      fullPage: true,
    });

    // Simulate the billing service detecting a duplicate card via webhook
    // (in production this fires when payment_method.attached has a known fingerprint)
    await setDuplicateCardFlag(page, billingOrigin, userId);

    // User navigates to the billing portal (e.g. after being redirected back
    // from Stripe, or via the "Open Billing Portal" link in Settings)
    await page.goto(`${billingOrigin}/subscription`);

    await expect(page.locator("text=Card already on file")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator("text=This card is already added to your account"),
    ).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "dup-card-02-billing-banner.png"),
      fullPage: true,
    });

    // ── Banner shown only once ─────────────────────────────────────────────
    // The flag is atomically cleared on first read — second visit has no banner.
    await page.goto(`${billingOrigin}/subscription`);
    await expect(page.locator("text=Card already on file")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "dup-card-03-banner-cleared.png"),
      fullPage: true,
    });

    console.log(
      `✅  Duplicate card detection flow complete (userId: ${userId})`,
    );
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
