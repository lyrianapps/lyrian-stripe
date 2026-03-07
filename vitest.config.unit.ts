import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Config for unit tests that don't require database
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 10000,
    include: ["tests/unit/**/*.test.ts"],
    // No setup file needed - tests mock their own dependencies
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
