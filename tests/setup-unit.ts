/**
 * Setup file for unit tests that don't require database
 */
import { vi } from "vitest";

// Mock the env module with test values
vi.mock("@/env", () => ({
  env: {
    DATABASE_URL: "postgresql://mock",
    SAAS_JWT_SECRET: "test-jwt-secret-for-testing",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    CRON_SECRET: "test-cron-secret-1234",
    STRIPE_PK_KEY: "pk_test_mock",
    STRIPE_SECRET_KEY: "sk_test_mock_key",
    STRIPE_WEBHOOK_SECRET: "whsec_test_mock_secret",
    RESEND_API_KEY: "re_test_mock_key",
    FROM_EMAIL: "test@example.com",
  },
}));

// Mock logger to prevent console noise
vi.mock("@/app/middleware/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logError: vi.fn(),
}));
