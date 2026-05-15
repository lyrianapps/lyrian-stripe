/**
 * E2E Tests: Declined / Blocked Card Checkout
 *
 * Verifies that when Stripe redirects to success_url with payment_status: "unpaid"
 * (e.g. lost card, Radar-blocked card), the user is redirected back to the
 * subscription page with a context-specific warning banner.
 *
 * On a valid payment the user is redirected to the subscription page with a
 * green "Subscription activated" banner.
 *
 * In the test environment, _test_payment_status / _test_decline_code override
 * the Stripe API call so no real Stripe session is needed.
 */
import { test, expect } from "./fixtures";

const FAKE_SESSION_ID = "cs_test_e2e_declined_session";

test.describe("Declined card at checkout", () => {
  test("shows 'Card reported lost' banner for a lost card", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(
      `/subscription/success?session_id=${FAKE_SESSION_ID}&_test_payment_status=unpaid&_test_decline_code=lost_card`,
    );

    await expect(page).toHaveURL(/\/subscription/);
    await expect(page.locator("text=Card reported lost")).toBeVisible();
    await expect(page.locator("text=reported as lost")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/checkout-declined-lost-card.png",
      fullPage: true,
    });
  });

  test("shows 'Transaction flagged' banner for a fraudulent / Radar-blocked card", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(
      `/subscription/success?session_id=${FAKE_SESSION_ID}&_test_payment_status=unpaid&_test_decline_code=fraudulent`,
    );

    await expect(page).toHaveURL(/\/subscription/);
    await expect(page.locator("text=Transaction flagged")).toBeVisible();
    await expect(page.locator("text=flagged as suspicious")).toBeVisible();
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/checkout-declined-fraud-card.png",
      fullPage: true,
    });
  });

  test("shows generic 'Card declined' banner for an unrecognised decline code", async ({
    authenticatedPage: page,
  }) => {
    // No _test_decline_code → falls back to generic "declined"
    await page.goto(
      `/subscription/success?session_id=${FAKE_SESSION_ID}&_test_payment_status=unpaid`,
    );

    await expect(page).toHaveURL(/\/subscription/);
    await expect(page.locator("text=Card declined")).toBeVisible();
    await expect(page.locator("text=declined or flagged")).toBeVisible();
  });

  test("shows green 'Subscription activated' banner for a valid card", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(
      `/subscription/success?session_id=${FAKE_SESSION_ID}&_test_payment_status=paid`,
    );

    await expect(page).toHaveURL(/\/subscription\?checkout_success=1/);
    await expect(page.locator("text=Subscription activated")).toBeVisible();
    await expect(
      page.locator("text=Your payment was successful"),
    ).toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();
    await expect(page.locator("text=Card reported lost")).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/checkout-success-valid-card.png",
      fullPage: true,
    });
  });

  test("shows green 'Subscription activated' banner when no session_id (direct navigation)", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/subscription/success");

    await expect(page).toHaveURL(/\/subscription\?checkout_success=1/);
    await expect(page.locator("text=Subscription activated")).toBeVisible();
  });

  test("no banners shown on a normal subscription page visit", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/subscription");

    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();
    await expect(page.locator("text=Card reported lost")).not.toBeVisible();
  });

  test("plan cards still visible after a declined redirect", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(
      `/subscription/success?session_id=${FAKE_SESSION_ID}&_test_payment_status=unpaid&_test_decline_code=lost_card`,
    );

    await expect(page.locator("h1")).toContainText("Subscription");
    await expect(page.locator("text=Basic").first()).toBeVisible();
  });
});
