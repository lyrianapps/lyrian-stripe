import { redirect } from "next/navigation";

/**
 * Legacy entry point — Stripe sessions created before the checkout-return
 * Route Handler was introduced land here. Forward all params to the Route
 * Handler, which can set cookies reliably.
 */
export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) query.set(key, v);
  }
  redirect(`/api/billing/checkout-return?${query.toString()}`);
}
