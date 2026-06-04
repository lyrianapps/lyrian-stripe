import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "never" }]],

  use: {
    baseURL:
      process.env.BASE_URL ??
      "https://lyrian-example-app-494926016713.us-central1.run.app",
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
