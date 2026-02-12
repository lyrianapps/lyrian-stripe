import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration
 *
 * Run with: npm run test:e2e
 * Run headed: npm run test:e2e -- --headed
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Run tests sequentially for DB consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start local dev server before running tests
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
