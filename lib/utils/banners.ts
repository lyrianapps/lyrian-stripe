import { NoticeBannerConfig } from "@/app/components/NoticeBanner";

// ---------------------------------------------------------------------------
// Decline code → banner message map.
// Add new Stripe decline codes here without touching the page.
// ---------------------------------------------------------------------------
const DECLINE_MESSAGES: Record<string, { title: string; body: string }> = {
  lost_card: {
    title: "Card reported lost",
    body: "Your card has been reported as lost. No charge was made and no subscription was created. Please use a different card.",
  },
  stolen_card: {
    title: "Card reported stolen",
    body: "Your card has been reported as stolen. No charge was made and no subscription was created. Please use a different card.",
  },
  fraudulent: {
    title: "Transaction flagged",
    body: "This transaction was flagged as suspicious and was not processed. No charge was made and no subscription was created. Please use a different card or contact your bank.",
  },
};

const DECLINE_FALLBACK: { title: string; body: string } = {
  title: "Card declined",
  body: "Your card was declined or flagged. No charge was made and no subscription was created. Please try a different card.",
};

// ---------------------------------------------------------------------------
// Chain of Responsibility pattern for banner resolution.
// Each handler decides whether to contribute a banner, then delegates to the
// next handler in the chain. To add a new banner type, create a subclass and
// append it to buildBannerChain() — no other code needs to change.
// ---------------------------------------------------------------------------

export type BannerInput = {
  checkoutDeclinedCode: string | undefined;
  checkoutSuccess: boolean;
  duplicateCardDetected: boolean;
};

abstract class BannerHandler {
  private next: BannerHandler | null = null;

  setNext(handler: BannerHandler): BannerHandler {
    this.next = handler;
    return handler;
  }

  handle(input: BannerInput): NoticeBannerConfig[] {
    const downstream = this.next ? this.next.handle(input) : [];
    const banner = this.resolve(input);
    return banner ? [banner, ...downstream] : downstream;
  }

  protected abstract resolve(input: BannerInput): NoticeBannerConfig | null;
}

class CheckoutDeclineHandler extends BannerHandler {
  protected resolve({
    checkoutDeclinedCode,
  }: BannerInput): NoticeBannerConfig | null {
    if (!checkoutDeclinedCode) return null;
    const msg = DECLINE_MESSAGES[checkoutDeclinedCode] ?? DECLINE_FALLBACK;
    return { variant: "error", ...msg };
  }
}

class CheckoutSuccessHandler extends BannerHandler {
  protected resolve({
    checkoutSuccess,
  }: BannerInput): NoticeBannerConfig | null {
    if (!checkoutSuccess) return null;
    return {
      variant: "success",
      title: "Subscription activated",
      body: "Your payment was successful and your subscription is now active.",
    };
  }
}

class DuplicateCardHandler extends BannerHandler {
  protected resolve({
    duplicateCardDetected,
  }: BannerInput): NoticeBannerConfig | null {
    if (!duplicateCardDetected) return null;
    return {
      variant: "error",
      title: "Card already on file",
      body: "This card is already added to your account. No changes were made.",
    };
  }
}

function buildBannerChain(): BannerHandler {
  const decline = new CheckoutDeclineHandler();
  const success = new CheckoutSuccessHandler();
  const duplicate = new DuplicateCardHandler();
  decline.setNext(success).setNext(duplicate);
  return decline;
}

export function resolveNoticeBanners(input: BannerInput): NoticeBannerConfig[] {
  return buildBannerChain().handle(input);
}
