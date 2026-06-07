/**
 * E2E Tests: Subscription Status Display
 *
 * Tests that users see correct subscription information after login.
 */
import { test, expect, createTestSubscription } from "./fixtures";

test.describe("Subscription Status Display", () => {
  test("shows free trial status for user without subscription", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription");

    // Should show subscription page
    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");

    // Should show free trial plan card
    await expect(
      authenticatedPage.locator("text=Free Trial").first(),
    ).toBeVisible();

    // Cancel section and button are hidden for free trial users (nothing to cancel)
    await expect(
      authenticatedPage.locator('button:has-text("Cancel Subscription")'),
    ).toHaveCount(0);
  });

  test("shows basic plan status for subscribed user", async ({
    authenticatedPage,
  }) => {
    // Create a basic subscription for this user
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Should show Basic as current plan (use specific selector to avoid matching button)
    await expect(authenticatedPage.getByText("Current Plan:")).toBeVisible();

    // Basic plan card should show "Current plan" badge (indicating it's the active plan)
    const currentPlanBadge = authenticatedPage.getByText("Current plan", {
      exact: true,
    });
    await expect(currentPlanBadge).toBeVisible();

    // Cancel button should be enabled
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel Subscription")',
    );
    await expect(cancelButton).toBeEnabled();
  });

  test("shows canceled status with expiration date", async ({
    authenticatedPage,
  }) => {
    // Create a canceled subscription
    await createTestSubscription(authenticatedPage, {
      plan: "basic",
      cancelAtPeriodEnd: true,
    });

    await authenticatedPage.goto("/subscription");

    // Should show cancellation notice
    await expect(
      authenticatedPage.locator("text=has been canceled"),
    ).toBeVisible();

    // Should show "access until" message with date
    await expect(
      authenticatedPage.locator("text=have access until"),
    ).toBeVisible();
  });
});
