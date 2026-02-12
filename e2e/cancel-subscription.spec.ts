/**
 * E2E Tests: Cancel Subscription Flow
 *
 * Tests that cancel button works and shows confirmation.
 */
import { Dialog } from "@playwright/test";
import { test, expect, createTestSubscription } from "./fixtures";

test.describe("Cancel Subscription Flow", () => {
  test("shows confirmation dialog when clicking cancel", async ({
    authenticatedPage,
  }) => {
    // Create a basic subscription
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Listen for the confirm dialog
    authenticatedPage.on("dialog", async (dialog: Dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Are you sure");
      expect(dialog.message()).toContain("cancel your subscription");
      await dialog.dismiss(); // Click "Cancel" on the dialog
    });

    // Click the cancel button
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel Subscription")',
    );
    await cancelButton.click();
  });

  test("cancels subscription when user confirms", async ({
    authenticatedPage,
  }) => {
    // Create a basic subscription
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Set up dialog handler BEFORE clicking (handles both confirm and alert)
    authenticatedPage.on("dialog", async (dialog: Dialog) => {
      await dialog.accept();
    });

    // Click cancel button
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel Subscription")',
    );
    await cancelButton.click();

    // After cancellation, page should show cancellation status
    await expect(
      authenticatedPage.locator("text=has been canceled"),
    ).toBeVisible({ timeout: 10000 });

    // Should show expiration info
    await expect(
      authenticatedPage.locator("text=have access until"),
    ).toBeVisible();
  });

  test("does not cancel when user dismisses confirmation", async ({
    authenticatedPage,
  }) => {
    // Create a basic subscription
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Dismiss the confirm dialog (click "Cancel")
    authenticatedPage.on("dialog", async (dialog: Dialog) => {
      if (dialog.type() === "confirm") {
        await dialog.dismiss();
      }
    });

    // Click cancel button
    const cancelButton = authenticatedPage.locator(
      'button:has-text("Cancel Subscription")',
    );
    await cancelButton.click();

    // Wait a moment
    await authenticatedPage.waitForTimeout(1000);

    // Should NOT show cancellation message
    await expect(
      authenticatedPage.locator("text=has been canceled"),
    ).not.toBeVisible();

    // Cancel button should still be visible and enabled
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();
  });
});
