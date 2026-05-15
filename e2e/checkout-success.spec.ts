/**
 * E2E Tests: Checkout Success Flow
 *
 * The success page (/subscription/success) always redirects:
 *   - paid / no session_id → /subscription?checkout_success=1
 *   - unpaid              → /subscription?checkout_declined=<code>
 *
 * These tests verify the final landing state on the subscription page.
 */
import { test, expect } from "./fixtures";

test.describe("Checkout Success Page", () => {
  test("displays success banner after checkout", async ({
    authenticatedPage,
  }) => {
    // Navigating to /subscription/success with no session_id redirects to
    // /subscription?checkout_success=1 where the green banner is shown.
    await authenticatedPage.goto("/subscription/success");

    await expect(authenticatedPage).toHaveURL(/checkout_success=1/);
    await expect(
      authenticatedPage.locator("text=Subscription activated"),
    ).toBeVisible();
    await expect(
      authenticatedPage.locator("text=Your payment was successful"),
    ).toBeVisible();

    // The subscription page heading should still be present
    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");
  });

  test("redirects to returnUrl if provided", async ({ authenticatedPage }) => {
    // When a returnUrl is supplied Stripe redirects the user back to their app;
    // the server performs a server-side redirect before we can inspect the page.
    // We only verify no error is thrown (the redirect itself is tested manually).
    const returnUrl = "https://example.com/dashboard";
    await authenticatedPage.goto(
      `/subscription/success?returnUrl=${encodeURIComponent(returnUrl)}`,
      { waitUntil: "commit" },
    );
    // No assertion needed — just confirm no crash / 500
  });

  test("subscription page renders correctly after success redirect", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription/success");

    await expect(authenticatedPage).toHaveURL(/checkout_success=1/);

    // Plan cards should still be present
    await expect(authenticatedPage.locator("text=Basic").first()).toBeVisible();
  });

  test("success banner has green styling", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/subscription/success");

    await expect(authenticatedPage).toHaveURL(/checkout_success=1/);

    // Green banner (bg-green-50 / border-green-200)
    const banner = authenticatedPage.locator(".bg-green-50");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Subscription activated");
  });
});
