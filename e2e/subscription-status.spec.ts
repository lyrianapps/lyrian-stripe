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

    // Should show free trial as current plan
    await expect(authenticatedPage.locator("text=Current Plan")).toBeVisible();
    await expect(
      authenticatedPage.locator("text=Free Trial").first(),
    ).toBeVisible();

    // Cancel button should be disabled for free trial
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel Subscription")',
    );
    await expect(cancelButton).toBeDisabled();
  });

  test("shows basic plan status for subscribed user", async ({
    authenticatedPage,
  }) => {
    // Create a basic subscription for this user
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Should show Basic as current plan (use specific selector to avoid matching button)
    await expect(authenticatedPage.getByText("Current Plan:")).toBeVisible();

    // Basic plan card should show "Current Plan" button (indicating it's the active plan)
    const currentPlanButton = authenticatedPage.getByRole("button", {
      name: "Current Plan",
    });
    await expect(currentPlanButton).toBeVisible();

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
