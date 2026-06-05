/**
 * E2E: Billing portal banner scenarios (example-app context)
 *
 * These tests verify that after checkout events the billing service's
 * subscription page (/subscription) renders the correct notice banner.
 *
 * Strategy:
 *   1. Register a new user on the example app (gets app_session cookie).
 *   2. Navigate to /api/billing/portal-redirect — the example app signs a
 *      short-lived JWT and redirects to the billing service portal, which
 *      creates a billing_session cookie on the billing service domain.
 *   3. From there, navigate directly to the billing service subscription page
 *      with the banner-triggering query params. These params are the same ones
 *      the success/success page sets on redirect — no test-only overrides needed.
 *
 * Covered scenarios:
 *   ✅ checkout_success=1          → "Subscription activated" (green)
 *   ✅ checkout_declined=lost_card → "Card reported lost" (red)
 *   ✅ checkout_declined=<unknown> → generic "Card declined" (red)
 *   ✅ duplicateCardDetected flag  → "Card already on file" (red, shown once)
 *   ✅ Via /subscription/success redirect (full Stripe → success page → subscription chain)
 */
import { test, expect, type Page } from "@playwright/test";
import path from "path";

const TEST_PASSWORD = "test1234";
const BILLING_APP_ID = "example_app";

// Track every userId created so afterAll can clean up billing records
const createdUserIds: string[] = [];
let billingOriginGlobal = "";

function uniqueEmail(tag: string) {
  return `banner-${tag}-${Date.now()}@example.com`;
}

/**
 * Registers a fresh user on the example app, then navigates the billing portal
 * redirect so the billing service sets a billing_session cookie.
 *
 * Returns:
 *   billingOrigin — the billing service origin (e.g. "https://lyrian-stripe-....run.app")
 *   userId        — the UUID stored in localStorage, used as externalUserId on the
 *                   billing service (needed to call e2e-setup from the test)
 */
async function registerAndOpenPortal(
  page: Page,
  emailTag: string,
): Promise<{ billingOrigin: string; userId: string }> {
  const email = uniqueEmail(emailTag);

  await page.goto("/login");
  await expect(page.locator("text=Create account")).toBeVisible();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]:has-text("Create account")');
  await page.waitForURL("/", { timeout: 15000 });

  // Read the userId that was stored in localStorage during registration.
  // The billing service uses this as externalUserId.
  const userId = await page.evaluate<string>(() => {
    const users = JSON.parse(
      localStorage.getItem("lyrian_users") ?? "[]",
    ) as Array<{ userId: string }>;
    return users[users.length - 1]?.userId ?? "";
  });

  // The portal-redirect endpoint signs a JWT and redirects the browser to the
  // billing service portal, which sets billing_session and lands on /subscription.
  await page.goto("/api/billing/portal-redirect");
  await page.waitForURL(/\/subscription/, { timeout: 20000 });

  const billingOrigin = new URL(page.url()).origin;
  // Track for afterAll cleanup
  createdUserIds.push(userId);
  billingOriginGlobal = billingOrigin;

  return { billingOrigin, userId };
}

// The billing service appId for the example app (matches BILLING_APP_ID env var).
const BILLING_APP_ID = "example_app";

const APP_URL =
  process.env.BASE_URL ??
  "https://lyrian-example-app-494926016713.us-central1.run.app";

// ─── Success banner ───────────────────────────────────────────────────────────

test.describe("Billing portal — success banner", () => {
  test("shows 'Subscription activated' banner after successful checkout", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "success");
    const returnUrl = `${APP_URL}/settings`;

    await page.goto(
      `${billingOrigin}/subscription?checkout_success=1&returnUrl=${encodeURIComponent(returnUrl)}`,
    );

    await expect(page.locator("text=Subscription activated")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator("text=Your payment was successful"),
    ).toBeVisible();

    // No error banners alongside success
    await expect(page.locator("text=Card declined")).not.toBeVisible();
    await expect(page.locator("text=Card reported lost")).not.toBeVisible();

    // "Back" link should point back to the example app
    const backLink = page.locator('a:has-text("Back")');
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", returnUrl);

    await page.screenshot({
      path: path.join("e2e", "screenshots", "banner-checkout-success.png"),
      fullPage: true,
    });
  });

  test("clicking Back after success banner returns to example app settings", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "success-back");
    const appSettingsUrl = `${APP_URL}/settings`;

    await page.goto(
      `${billingOrigin}/subscription?checkout_success=1&returnUrl=${encodeURIComponent(appSettingsUrl)}`,
    );

    await expect(page.locator("text=Subscription activated")).toBeVisible();
    await page.click('a:has-text("Back")');

    await page.waitForURL(
      /lyrian-example-app.*\.run\.app\/settings|localhost.*\/settings/,
      { timeout: 15000 },
    );
  });
});

// ─── Declined card banners ────────────────────────────────────────────────────

test.describe("Billing portal — declined card banners", () => {
  test("shows 'Card reported lost' banner for lost_card decline code", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "lost-card");

    await page.goto(
      `${billingOrigin}/subscription?checkout_declined=lost_card`,
    );

    await expect(page.locator("text=Card reported lost")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as lost")).toBeVisible();

    // No success or other error banners
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card already on file")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "banner-declined-lost-card.png"),
      fullPage: true,
    });
  });

  test("shows 'Transaction flagged' banner for fraudulent decline code", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "fraud");

    await page.goto(
      `${billingOrigin}/subscription?checkout_declined=fraudulent`,
    );

    await expect(page.locator("text=Transaction flagged")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=flagged as suspicious")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "banner-declined-fraud.png"),
      fullPage: true,
    });
  });

  test("shows generic 'Card declined' banner for unknown decline code", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "generic-decline",
    );

    await page.goto(
      `${billingOrigin}/subscription?checkout_declined=do_not_honor`,
    );

    await expect(page.locator("text=Card declined")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=declined or flagged")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "banner-declined-generic.png"),
      fullPage: true,
    });
  });

  test("no banner shown on a clean subscription page visit", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "no-banner");

    // Plain /subscription — no banner params
    await page.goto(`${billingOrigin}/subscription`);

    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();
    await expect(page.locator("text=Card reported lost")).not.toBeVisible();
    await expect(page.locator("text=Card already on file")).not.toBeVisible();

    // Heading should always render
    await expect(page.locator("h1")).toContainText("Subscription");
  });
});

// ─── Duplicate card detection ─────────────────────────────────────────────────

test.describe("Billing portal — duplicate card banner", () => {
  /**
   * Set the duplicateCardDetected flag on the billing service directly via its
   * dev/e2e-setup endpoint, mirroring what the payment_method.attached webhook
   * does in production. This lets us test the banner without a real Stripe event.
   */
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

  test("shows 'Card already on file' banner when duplicate is detected", async ({
    page,
  }) => {
    const { billingOrigin, userId } = await registerAndOpenPortal(
      page,
      "dup-card",
    );
    await setDuplicateCardFlag(page, billingOrigin, userId);

    await page.goto(`${billingOrigin}/subscription`);

    await expect(page.locator("text=Card already on file")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator("text=This card is already added to your account"),
    ).toBeVisible();

    // Must not show alongside success or other decline banners
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();

    await page.screenshot({
      path: path.join("e2e", "screenshots", "banner-duplicate-card.png"),
      fullPage: true,
    });
  });

  test("banner is shown only once — cleared on the next page load", async ({
    page,
  }) => {
    const { billingOrigin, userId } = await registerAndOpenPortal(
      page,
      "dup-card-once",
    );
    await setDuplicateCardFlag(page, billingOrigin, userId);

    // First visit — banner visible
    await page.goto(`${billingOrigin}/subscription`);
    await expect(page.locator("text=Card already on file")).toBeVisible({
      timeout: 10000,
    });

    // Second visit — flag was atomically cleared, banner gone
    await page.goto(`${billingOrigin}/subscription`);
    await expect(page.locator("text=Card already on file")).not.toBeVisible();
  });

  test("no duplicate banner when flag has not been set", async ({ page }) => {
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "dup-card-clean",
    );

    await page.goto(`${billingOrigin}/subscription`);

    await expect(page.locator("text=Card already on file")).not.toBeVisible();
  });
});

// ─── Via checkout redirect (success page → subscription page) ─────────────────
//
// These tests exercise the FULL redirect chain that Stripe triggers after checkout:
//
//   Stripe → /subscription/success?session_id=...&returnUrl=...&appId=...
//          → /subscription?checkout_success=1&returnUrl=...          (paid)
//          → /subscription?checkout_declined=<code>&returnUrl=...    (unpaid)
//
// The billing service exposes _test_payment_status / _test_decline_code query
// params on the success page (non-production only) so we can walk this chain
// without a real Stripe session — exactly what Stripe would send.

test.describe("Billing portal — via checkout success-page redirect", () => {
  const FAKE_SESSION_ID = "cs_test_e2e_example_app";

  test("paid checkout → redirects through success page → shows success banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "via-success");
    const returnUrl = `${APP_URL}/settings`;

    // Simulate what Stripe sends to success_url after a successful payment.
    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=paid` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );

    // Success page must redirect to /subscription?checkout_success=1
    await expect(page).toHaveURL(/\/subscription\?.*checkout_success=1/);

    await expect(page.locator("text=Subscription activated")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator("text=Your payment was successful"),
    ).toBeVisible();

    // "Back" link must point back to the example app
    await expect(page.locator('a:has-text("Back")')).toHaveAttribute(
      "href",
      returnUrl,
    );

    // No error banners
    await expect(page.locator("text=Card declined")).not.toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "via-redirect-checkout-success.png",
      ),
      fullPage: true,
    });
  });

  test("unpaid checkout (lost card) → redirects through success page → shows decline banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "via-lost-card",
    );
    const returnUrl = `${APP_URL}/settings`;

    // Simulate Stripe redirecting to success_url when the card was blocked.
    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=unpaid` +
        `&_test_decline_code=lost_card` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`,
    );

    // Success page must redirect to /subscription?checkout_declined=lost_card
    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=lost_card/,
    );

    await expect(page.locator("text=Card reported lost")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=reported as lost")).toBeVisible();

    // No success banner alongside the error
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: path.join(
        "e2e",
        "screenshots",
        "via-redirect-declined-lost-card.png",
      ),
      fullPage: true,
    });
  });

  test("unpaid checkout (stolen card) → redirects through success page → shows decline banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "via-stolen-card",
    );
    const returnUrl = `${APP_URL}/settings`;

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=unpaid` +
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
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
  });

  test("unpaid checkout (insufficient funds) → redirects through success page → shows decline banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "via-insufficient-funds",
    );
    const returnUrl = `${APP_URL}/settings`;

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=unpaid` +
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
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
  });

  test("unpaid checkout (fraudulent) → redirects through success page → shows flagged banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "via-fraud");

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=unpaid` +
        `&_test_decline_code=fraudulent`,
    );

    await expect(page).toHaveURL(
      /\/subscription\?.*checkout_declined=fraudulent/,
    );
    await expect(page.locator("text=Transaction flagged")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
  });

  test("unpaid checkout (unknown code) → redirects through success page → shows generic decline banner", async ({
    page,
  }) => {
    const { billingOrigin } = await registerAndOpenPortal(page, "via-generic");

    await page.goto(
      `${billingOrigin}/subscription/success` +
        `?session_id=${FAKE_SESSION_ID}` +
        `&_test_payment_status=unpaid`,
    );

    await expect(page).toHaveURL(/\/subscription\?.*checkout_declined=/);
    await expect(page.locator("text=Card declined")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=declined or flagged")).toBeVisible();
  });

  test("no session_id → treated as success → shows success banner", async ({
    page,
  }) => {
    // When session_id is absent (e.g. Stripe omits it) the success page falls
    // through to the success redirect — webhook is source of truth for status.
    const { billingOrigin } = await registerAndOpenPortal(
      page,
      "via-no-session",
    );

    await page.goto(`${billingOrigin}/subscription/success`);

    await expect(page).toHaveURL(/\/subscription\?.*checkout_success=1/);
    await expect(page.locator("text=Subscription activated")).toBeVisible({
      timeout: 10000,
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
