/**
 * Mock Stripe client for testing
 */
import { vi } from "vitest";

export const mockStripeSubscription = {
  id: "sub_test_123",
  customer: "cus_test_123",
  status: "active",
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: {
          id: "price_test_basic",
          product: "prod_test_basic",
        },
      },
    ],
  },
};

export const mockStripeCustomer = {
  id: "cus_test_123",
  email: "test@example.com",
};

export const mockStripeCheckoutSession = {
  id: "cs_test_123",
  url: "https://checkout.stripe.com/test",
  customer: "cus_test_123",
  subscription: "sub_test_123",
};

export const mockStripeBillingPortalSession = {
  id: "bps_test_123",
  url: "https://billing.stripe.com/portal/test",
};

/**
 * Creates a mock Stripe instance with commonly used methods
 */
export function createMockStripe() {
  return {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(mockStripeSubscription),
      update: vi.fn().mockResolvedValue(mockStripeSubscription),
      cancel: vi
        .fn()
        .mockResolvedValue({ ...mockStripeSubscription, status: "canceled" }),
    },
    customers: {
      create: vi.fn().mockResolvedValue(mockStripeCustomer),
      retrieve: vi.fn().mockResolvedValue(mockStripeCustomer),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue(mockStripeCheckoutSession),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue(mockStripeBillingPortalSession),
      },
    },
    webhooks: {
      constructEvent: vi.fn((payload, sig, secret) => JSON.parse(payload)),
    },
  };
}

// Singleton mock instance
export const mockStripe = createMockStripe();

// Mock the stripe module
vi.mock("@/lib/stripe", () => ({
  stripe: mockStripe,
}));
