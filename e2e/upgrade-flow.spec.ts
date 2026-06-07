/**
 * E2E Tests: Subscription Upgrade Flow
 *
 * Simulates a user upgrading from free trial to a paid plan.
 *
 * How it works:
 *   1. User starts on free trial — the subscription page shows Basic/Pro plan cards.
 *   2. Clicks "Upgrade" — the app calls /api/billing/checkout and would normally
 *      redirect to Stripe hosted checkout. We intercept that redirect and instead
 *      return our own success page URL.
 *   3. We simulate Stripe checkout completing by calling /api/dev/e2e-setup
 *      with the target plan (same DB write the checkout.session.completed webhook produces).
 *   4. We verify the success page and then the /subscription page reflects the upgraded plan.
 *
 * Why we don't drive the real Stripe UI:
 *   Stripe's hosted checkout page blocks browser automation. The webhook handler
 *   (checkout.session.completed) is already covered by integration tests.
 *   This spec tests the full UI flow around the checkout.
 *
 * AppPlan seeding:
 *   The /api/dev/e2e-setup endpoint now seeds test Basic and Pro AppPlan records
 *   for the test app automatically, so the subscription page renders plan cards.
 */
import { test, expect } from "./fixtures";
import { createTestSubscription } from "./fixtures";

test.describe("Subscription Upgrade Flow", () => {
  test("user upgrades from free trial to basic plan", async ({
    authenticatedPage,
  }) => {
    // ── Step 1: Verify free trial state ───────────────────────────────────
    await authenticatedPage.goto("/subscription");

    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");

    // Cancel section is hidden for free trial users (nothing to cancel)
    await expect(
      authenticatedPage.locator('button:has-text("Cancel Subscription")'),
    ).toHaveCount(0);

    // Upgrade buttons are visible for paid plans (Basic, Pro)
    const upgradeButton = authenticatedPage
      .getByRole("button", { name: "Upgrade" })
      .first();
    await expect(upgradeButton).toBeVisible();

    // ── Step 2: Intercept checkout redirect ────────────────────────────────
    // /api/billing/checkout returns a Stripe URL; we return our own success page
    // so the browser stays on localhost and we control the flow.
    let checkoutCalled = false;
    await authenticatedPage.route("**/api/billing/checkout", async (route) => {
      checkoutCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: `http://localhost:3000/subscription/success`,
        }),
      });
    });

    // ── Step 3: Click Upgrade on the first plan (Basic) ───────────────────
    await upgradeButton.click();

    // The success page immediately redirects to /subscription?checkout_success=1
    // so we wait for the final subscription page URL.
    await authenticatedPage.waitForURL(/checkout_success=1/, {
      timeout: 10000,
    });

    expect(checkoutCalled).toBe(true);

    // ── Step 4: Simulate Stripe checkout completion ────────────────────────
    // In production, Stripe fires checkout.session.completed → our webhook
    // creates the subscription record. We replicate that DB write directly.
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    // ── Step 5: Verify success banner on subscription page ────────────────
    await expect(
      authenticatedPage.locator("text=Subscription activated"),
    ).toBeVisible();
    await expect(
      authenticatedPage.locator("text=Your payment was successful"),
    ).toBeVisible();

    // ── Step 6: Navigate back and verify upgraded plan ────────────────────
    await authenticatedPage.goto("/subscription");

    // Basic plan card should now show "Current plan" badge
    const currentPlanBadge = authenticatedPage.getByText("Current plan", {
      exact: true,
    });
    await expect(currentPlanBadge).toBeVisible();

    // Cancel button should now be enabled (active paid subscription)
    await expect(
      authenticatedPage.locator('button:has-text("Cancel Subscription")'),
    ).toBeEnabled();
  });

  test("free trial user sees upgrade plan buttons", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription");

    // Plan cards visible — at least one Upgrade button
    const upgradeButtons = authenticatedPage.getByRole("button", {
      name: "Upgrade",
    });
    await expect(upgradeButtons.first()).toBeVisible();

    // Cancel section is hidden for free trial users (nothing to cancel)
    await expect(
      authenticatedPage.locator('button:has-text("Cancel Subscription")'),
    ).toHaveCount(0);
  });

  test("already subscribed user sees current plan button, not upgrade", async ({
    authenticatedPage,
  }) => {
    // Simulate a pre-existing basic subscription
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Basic plan card renders "Current plan" badge
    const currentPlanBadge = authenticatedPage.getByText("Current plan", {
      exact: true,
    });
    await expect(currentPlanBadge).toBeVisible();

    // Cancel subscription is available for active paid plan
    await expect(
      authenticatedPage.locator('button:has-text("Cancel Subscription")'),
    ).toBeEnabled();
  });
});
