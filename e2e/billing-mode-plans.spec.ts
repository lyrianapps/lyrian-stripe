/**
 * E2E: Billing mode plan filtering — billing portal (/subscription)
 *
 * Verifies that the /subscription page shows only the plans matching the
 * billingType query param passed from the SaaS app's portal-redirect:
 *
 *   ?billingType=flat_rate  →  Basic + Pro visible, Pay As You Go hidden
 *   ?billingType=metered    →  Pay As You Go visible, Basic + Pro hidden
 *   no billingType param    →  All plans visible (free_trial fallback)
 *
 * Uses the e2e-setup fixture which seeds all three test plans (basic, pro,
 * paygo) for every test app, so the filter is the only variable.
 */
import { test, expect } from "./fixtures";

test.describe("Billing mode plan filtering on /subscription", () => {
  test("billingType=flat_rate shows only subscription plans", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription?billingType=flat_rate");
    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");

    // Subscription plans visible
    await expect(
      authenticatedPage.getByText("Basic", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      authenticatedPage.getByText("Pro", { exact: true }),
    ).toBeVisible();

    // Metered plan NOT visible
    await expect(
      authenticatedPage.getByText("Pay As You Go", { exact: true }),
    ).not.toBeVisible();

    // Banner reflects subscription billing
    await expect(
      authenticatedPage.getByText("Subscription billing"),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Usage-based billing"),
    ).not.toBeVisible();
  });

  test("billingType=metered shows only metered plans", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription?billingType=metered");
    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");

    // Metered plan visible
    await expect(
      authenticatedPage.getByText("Pay As You Go", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Subscription plans NOT visible
    await expect(
      authenticatedPage.getByText("Basic", { exact: true }),
    ).not.toBeVisible();
    await expect(
      authenticatedPage.getByText("Pro", { exact: true }),
    ).not.toBeVisible();

    // Banner reflects usage-based billing
    await expect(
      authenticatedPage.getByText("Usage-based billing"),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Subscription billing"),
    ).not.toBeVisible();
  });

  test("no billingType param shows all plans (free-trial fallback)", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/subscription");
    await expect(authenticatedPage.locator("h1")).toContainText("Subscription");

    // All plans visible when no billingType hint provided
    await expect(
      authenticatedPage.getByText("Basic", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      authenticatedPage.getByText("Pro", { exact: true }),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Pay As You Go", { exact: true }),
    ).toBeVisible();
  });

  test("subscribed flat_rate user sees only their billing type plans", async ({
    authenticatedPage,
  }) => {
    // Create a basic (flat_rate) subscription — billingType should be inferred
    // from the active plan, ignoring any URL param
    const { createTestSubscription } = await import("./fixtures");
    await createTestSubscription(authenticatedPage, { plan: "basic" });

    await authenticatedPage.goto("/subscription");

    // Should show current plan badge
    await expect(
      authenticatedPage.getByText("Current plan", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Only flat_rate plans visible (derived from active subscription, not URL)
    await expect(
      authenticatedPage.getByText("Basic", { exact: true }),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Pro", { exact: true }),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Pay As You Go", { exact: true }),
    ).not.toBeVisible();
  });

  test("subscribed metered user sees only their billing type plans", async ({
    authenticatedPage,
  }) => {
    const { createTestSubscription } = await import("./fixtures");
    await createTestSubscription(authenticatedPage, { plan: "paygo" });

    await authenticatedPage.goto("/subscription");

    // Should show current plan badge
    await expect(
      authenticatedPage.getByText("Current plan", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Only metered plans visible
    await expect(
      authenticatedPage.getByText("Pay As You Go", { exact: true }),
    ).toBeVisible();
    await expect(
      authenticatedPage.getByText("Basic", { exact: true }),
    ).not.toBeVisible();
    await expect(
      authenticatedPage.getByText("Pro", { exact: true }),
    ).not.toBeVisible();

    // Banner reflects usage-based billing
    await expect(
      authenticatedPage.getByText("Usage-based billing"),
    ).toBeVisible();
  });
});
