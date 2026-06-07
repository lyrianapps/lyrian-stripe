/**
 * Unit tests for subscription status business logic
 *
 * Tests selectBestSubscription, isExpired, and buildCancellationMessage
 * in isolation — no DB or HTTP required.
 */
import { describe, it, expect } from "vitest";
import {
  selectBestSubscription,
  isExpired,
  buildCancellationMessage,
  type SubscriptionRow,
} from "@/lib/subscription/statusLogic";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
const PAST = new Date(Date.now() - 2 * 60 * 60 * 1000); // -2 hours
const NOW = new Date();

function sub(
  overrides: Partial<SubscriptionRow> & Pick<SubscriptionRow, "status">,
): SubscriptionRow {
  return {
    plan: "basic",
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    accessEndsAt: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// selectBestSubscription
// ─────────────────────────────────────────────────────────────────────────────

describe("selectBestSubscription", () => {
  it("prefers active over trialing", () => {
    const result = selectBestSubscription([
      sub({ status: "trialing" }),
      sub({ status: "active" }),
    ]);
    expect(result.status).toBe("active");
  });

  it("prefers active over past_due", () => {
    const result = selectBestSubscription([
      sub({ status: "past_due" }),
      sub({ status: "active" }),
    ]);
    expect(result.status).toBe("active");
  });

  it("prefers past_due over trialing", () => {
    const result = selectBestSubscription([
      sub({ status: "trialing" }),
      sub({ status: "past_due" }),
    ]);
    expect(result.status).toBe("past_due");
  });

  it("prefers active over canceled", () => {
    const result = selectBestSubscription([
      sub({ status: "canceled" }),
      sub({ status: "active" }),
    ]);
    expect(result.status).toBe("active");
  });

  it("returns the only subscription when there is one", () => {
    const result = selectBestSubscription([sub({ status: "active" })]);
    expect(result.status).toBe("active");
  });

  it("does not mutate the input array", () => {
    const input = [sub({ status: "trialing" }), sub({ status: "active" })];
    selectBestSubscription(input);
    expect(input[0].status).toBe("trialing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isExpired
// ─────────────────────────────────────────────────────────────────────────────

describe("isExpired", () => {
  it("returns false for active subscription with future period end", () => {
    expect(
      isExpired(sub({ status: "active", currentPeriodEnd: FUTURE }), NOW),
    ).toBe(false);
  });

  it("returns false for active subscription with past period end (trust Stripe status)", () => {
    expect(
      isExpired(sub({ status: "active", currentPeriodEnd: PAST }), NOW),
    ).toBe(false);
  });

  it("returns true for past_due subscription with past period end", () => {
    expect(
      isExpired(sub({ status: "past_due", currentPeriodEnd: PAST }), NOW),
    ).toBe(true);
  });

  it("returns false for past_due subscription with future period end", () => {
    expect(
      isExpired(sub({ status: "past_due", currentPeriodEnd: FUTURE }), NOW),
    ).toBe(false);
  });

  it("returns true for trialing subscription with past period end", () => {
    expect(
      isExpired(sub({ status: "trialing", currentPeriodEnd: PAST }), NOW),
    ).toBe(true);
  });

  it("returns true for canceled subscription with past period end", () => {
    expect(
      isExpired(sub({ status: "canceled", currentPeriodEnd: PAST }), NOW),
    ).toBe(true);
  });

  it("returns false for canceled subscription with future period end", () => {
    expect(
      isExpired(sub({ status: "canceled", currentPeriodEnd: FUTURE }), NOW),
    ).toBe(false);
  });

  it("uses the provided now timestamp, not the system clock", () => {
    const wayInFuture = new Date("2099-01-01");
    // active with future period end — would expire relative to 2099
    expect(
      isExpired(
        sub({ status: "past_due", currentPeriodEnd: FUTURE }),
        wayInFuture,
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCancellationMessage
// ─────────────────────────────────────────────────────────────────────────────

describe("buildCancellationMessage", () => {
  it("formats the date in long US locale format", () => {
    const date = new Date("2026-12-31T00:00:00.000Z");
    const msg = buildCancellationMessage(date);
    expect(msg).toContain("December");
    expect(msg).toContain("2026");
    expect(msg).toMatch(/Your subscription will lose access on/);
  });

  it("includes the exact date", () => {
    const date = new Date("2026-07-04T12:00:00.000Z");
    const msg = buildCancellationMessage(date);
    expect(msg).toContain("July");
    expect(msg).toContain("4");
    expect(msg).toContain("2026");
  });
});
