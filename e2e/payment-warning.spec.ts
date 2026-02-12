import { test, expect, createTestSubscription } from "./fixtures";

test.describe("Payment Warning Banner", () => {
  test("shows warning banner when payment has failed", async ({
    authenticatedPage: page,
  }) => {
    // Create a subscription with a failed payment
    await createTestSubscription(page, {
      plan: "pro",
      hasFailedPayment: true,
    });

    // Navigate to subscription page
    await page.goto("http://localhost:3000/subscription");

    // Verify the warning banner is visible
    const banner = page.locator('[data-testid="payment-warning-banner"]');
    await expect(banner).toBeVisible();

    // Verify the warning text
    await expect(banner).toContainText("Your last payment failed");
    await expect(banner).toContainText(
      "update your payment method to avoid service interruption",
    );

    // Verify the Update Payment Method button exists
    const updateButton = page.locator('[data-testid="update-payment-button"]');
    await expect(updateButton).toBeVisible();
    await expect(updateButton).toContainText("Update Payment Method");

    // Capture screenshot for documentation
    await page.screenshot({
      path: "e2e/screenshots/payment-warning-banner.png",
      fullPage: true,
    });
  });

  test("does not show warning banner when payment is successful", async ({
    authenticatedPage: page,
  }) => {
    // Create a normal subscription without failed payment
    await createTestSubscription(page, {
      plan: "basic",
      hasFailedPayment: false,
    });

    // Navigate to subscription page
    await page.goto("http://localhost:3000/subscription");

    // Verify the warning banner is NOT visible
    const banner = page.locator('[data-testid="payment-warning-banner"]');
    await expect(banner).not.toBeVisible();
  });

  test("can dismiss the warning banner", async ({
    authenticatedPage: page,
  }) => {
    // Create a subscription with a failed payment
    await createTestSubscription(page, {
      plan: "pro",
      hasFailedPayment: true,
    });

    // Navigate to subscription page
    await page.goto("http://localhost:3000/subscription");

    // Verify the banner is visible
    const banner = page.locator('[data-testid="payment-warning-banner"]');
    await expect(banner).toBeVisible();

    // Click the dismiss button
    const dismissButton = page.locator(
      '[data-testid="dismiss-warning-button"]',
    );
    await dismissButton.click();

    // Verify the banner is no longer visible
    await expect(banner).not.toBeVisible();

    // Capture screenshot after dismissal
    await page.screenshot({
      path: "e2e/screenshots/payment-warning-dismissed.png",
      fullPage: true,
    });
  });
});
