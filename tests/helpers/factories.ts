/**
 * Test helpers and factories for creating test data
 */
import { prisma } from "@/lib/prisma";
import { Plan, SubscriptionStatus } from "@/lib/generated/prisma/enums";

// Generate unique IDs for test isolation
let counter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTestApp(
  overrides: Partial<{ id: string; name: string; apiKey: string }> = {},
) {
  return prisma.app.create({
    data: {
      id: overrides.id ?? uniqueId("test-app"),
      name: overrides.name ?? "Test App",
      apiKey: overrides.apiKey ?? uniqueId("test_key"),
    },
  });
}

export async function createTestBillingCustomer(
  appId: string,
  overrides: Partial<{ externalUserId: string; stripeCustomerId: string }> = {},
) {
  return prisma.billingCustomer.create({
    data: {
      appId,
      externalUserId: overrides.externalUserId ?? uniqueId("user"),
      stripeCustomerId: overrides.stripeCustomerId ?? uniqueId("cus_test"),
    },
  });
}

export async function createTestSubscription(
  billingCustomerId: string,
  overrides: Partial<{
    plan: Plan;
    status: SubscriptionStatus;
    stripeSubscriptionId: string;
    stripeProductId: string;
    stripePriceId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
  }> = {},
) {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  return prisma.subscription.create({
    data: {
      billingCustomerId,
      plan: overrides.plan ?? "basic",
      status: overrides.status ?? "active",
      stripeSubscriptionId:
        overrides.stripeSubscriptionId ?? `sub_test_${Date.now()}`,
      stripeProductId: overrides.stripeProductId ?? "prod_test",
      stripePriceId: overrides.stripePriceId ?? "price_test",
      currentPeriodStart: overrides.currentPeriodStart ?? now,
      currentPeriodEnd: overrides.currentPeriodEnd ?? periodEnd,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    },
  });
}

export async function createExpiredSubscription(billingCustomerId: string) {
  const now = new Date();
  const pastStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
  const pastEnd = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago (expired)

  return createTestSubscription(billingCustomerId, {
    currentPeriodStart: pastStart,
    currentPeriodEnd: pastEnd,
  });
}

export async function createTestSubscriptionWithFullSetup(
  overrides: {
    appId?: string;
    externalUserId?: string;
    plan?: Plan;
    status?: SubscriptionStatus;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: Date;
  } = {},
) {
  const app = await createTestApp({ id: overrides.appId });
  const customer = await createTestBillingCustomer(app.id, {
    externalUserId: overrides.externalUserId,
  });
  const subscription = await createTestSubscription(customer.id, {
    plan: overrides.plan,
    status: overrides.status,
    stripeSubscriptionId: overrides.stripeSubscriptionId,
    currentPeriodEnd: overrides.currentPeriodEnd,
  });

  return { app, customer, subscription };
}

/**
 * Creates a mock Stripe webhook event
 */
export function createMockStripeEvent(
  type: string,
  data: Record<string, unknown>,
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  return {
    id: `evt_test_${Date.now()}`,
    type,
    data: { object: data },
  };
}

/**
 * Creates mock Stripe subscription object
 */
export function createMockStripeSubscription(
  overrides: Partial<{
    id: string;
    customer: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_start: number;
    current_period_end: number;
    items: { data: Array<{ price: { id: string; product: string } }> };
  }> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: overrides.id ?? `sub_test_${Date.now()}`,
    customer: overrides.customer ?? `cus_test_${Date.now()}`,
    status: overrides.status ?? "active",
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    current_period_start: overrides.current_period_start ?? now,
    current_period_end: overrides.current_period_end ?? now + 30 * 24 * 60 * 60,
    items: overrides.items ?? {
      data: [{ price: { id: "price_test", product: "prod_test" } }],
    },
  };
}
