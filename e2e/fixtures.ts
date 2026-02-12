/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, Page } from "@playwright/test";

// Store test user info for use in helper functions
const testUserStore = new Map<
  Page,
  { appId: string; externalUserId: string }
>();

// Test fixtures for E2E tests
type TestFixtures = {
  authenticatedPage: Page;
  testUserId: string;
};

// Extend base test with custom fixtures
export const test = base.extend<TestFixtures>({
  testUserId: async ({}, use) => {
    // Generate unique test user ID
    const uniqueId = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await use(uniqueId);
  },

  authenticatedPage: async ({ page, testUserId }, use) => {
    const appId = `app_${testUserId}`;
    const externalUserId = `user_${testUserId}`;

    // Store user info for createTestSubscription helper
    testUserStore.set(page, { appId, externalUserId });

    // Use the e2e-setup endpoint to create a session
    // This creates the app, customer, and session in one call
    const response = await page.request.post(
      "http://localhost:3000/api/dev/e2e-setup",
      {
        data: { appId, externalUserId },
      },
    );

    if (!response.ok()) {
      throw new Error(
        `Failed to create test session: ${response.status()} ${await response.text()}`,
      );
    }

    const { sessionToken } = await response.json();

    // Set the session cookie
    await page.context().addCookies([
      {
        name: "billing_session",
        value: sessionToken,
        domain: "localhost",
        path: "/",
      },
    ]);

    await use(page);

    // Cleanup
    testUserStore.delete(page);
  },
});

export { expect };

/**
 * Helper to create a subscription via API
 */
export async function createTestSubscription(
  page: Page,
  options: {
    plan?: string;
    cancelAtPeriodEnd?: boolean;
    hasFailedPayment?: boolean;
  } = {},
): Promise<void> {
  const {
    plan = "basic",
    cancelAtPeriodEnd = false,
    hasFailedPayment = false,
  } = options;

  // Get stored user info for this page
  const userInfo = testUserStore.get(page);
  if (!userInfo) {
    throw new Error(
      "No user info found. Make sure to use authenticatedPage fixture first.",
    );
  }

  // Use the e2e-setup endpoint to add a subscription
  const response = await page.request.post(
    "http://localhost:3000/api/dev/e2e-setup",
    {
      data: {
        appId: userInfo.appId,
        externalUserId: userInfo.externalUserId,
        plan,
        cancelAtPeriodEnd,
        hasFailedPayment,
      },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to create test subscription: ${response.status()} ${await response.text()}`,
    );
  }
}
