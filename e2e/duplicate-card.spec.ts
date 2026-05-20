/**
 * E2E Tests: Duplicate Card Detection
 *
 * Verifies that when a user tries to add a card already on file (detected via the
 * payment_method.attached webhook), the subscription page shows a consistent
 * "Card already on file" banner — matching the style used for checkout decline messages.
 *
 * The e2e-setup endpoint sets the `duplicateCardDetected` flag directly on the
 * BillingCustomer, mirroring what the webhook does in production.
 *
 * The banner is shown exactly once: the subscription page atomically reads and
 * clears the flag, so a page refresh no longer shows it.
 */
import { test, expect, createTestSubscription } from "./fixtures";

test.describe("Duplicate card detection", () => {
  test("shows 'Card already on file' banner when duplicate is detected", async ({
    authenticatedPage: page,
  }) => {
    await createTestSubscription(page, {
      plan: "pro",
      duplicateCardDetected: true,
    });

    await page.goto("http://localhost:3000/subscription");

    await expect(page.locator("text=Card already on file")).toBeVisible();
    await expect(
      page.locator("text=This card is already added to your account"),
    ).toBeVisible();

    // Success and decline banners must not appear alongside it
    await expect(page.locator("text=Subscription activated")).not.toBeVisible();
    await expect(page.locator("text=Card declined")).not.toBeVisible();

    await page.screenshot({
      path: "e2e/screenshots/duplicate-card-banner.png",
      fullPage: true,
    });
  });

  test("banner is shown only once — cleared on next page load", async ({
    authenticatedPage: page,
  }) => {
    await createTestSubscription(page, {
      plan: "pro",
      duplicateCardDetected: true,
    });

    // First visit: banner visible
    await page.goto("http://localhost:3000/subscription");
    await expect(page.locator("text=Card already on file")).toBeVisible();

    // Second visit: flag was cleared, banner gone
    await page.goto("http://localhost:3000/subscription");
    await expect(page.locator("text=Card already on file")).not.toBeVisible();
  });

  test("no duplicate banner when flag is not set", async ({
    authenticatedPage: page,
  }) => {
    await createTestSubscription(page, { plan: "basic" });

    await page.goto("http://localhost:3000/subscription");

    await expect(page.locator("text=Card already on file")).not.toBeVisible();
  });
});
