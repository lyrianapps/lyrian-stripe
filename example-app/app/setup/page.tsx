"use client";

import { useState } from "react";
import { clientLogger } from "@/lib/clientLogger";

const log = clientLogger.child({ page: "setup" });

const EXAMPLE_PLANS = JSON.stringify(
  [
    {
      planKey: "basic",
      name: "Basic",
      description: "For individuals and small teams",
      price: 1000,
      billingType: "flat_rate",
      stripeProductId: "prod_REPLACE_ME",
      stripePriceId: "price_REPLACE_ME",
      sortOrder: 1,
    },
    {
      planKey: "pro",
      name: "Pro",
      description: "For businesses and power users",
      price: 3000,
      billingType: "flat_rate",
      stripeProductId: "prod_REPLACE_ME",
      stripePriceId: "price_REPLACE_ME",
      sortOrder: 2,
    },
  ],
  null,
  2,
);

type Status = "idle" | "loading" | "success" | "error";

export default function SetupPage() {
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [plansJson, setPlansJson] = useState(EXAMPLE_PLANS);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  function validateJson(val: string) {
    try {
      JSON.parse(val);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (jsonError) return;
    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripeSecretKey,
          stripePublishableKey,
          stripeWebhookSecret,
          plansJson,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        details?: Record<string, string[]>;
      };

      if (!res.ok) {
        const detail = data.details
          ? Object.entries(data.details)
              .map(([k, v]) => `${k}: ${v.join(", ")}`)
              .join(" · ")
          : null;
        const msg = detail ?? data.error ?? "Configuration failed";
        log.warn(
          { status: res.status, error: msg },
          "Setup configuration failed",
        );
        setErrorMsg(msg);
        setStatus("error");
        return;
      }

      log.info("App configured successfully via setup page");
      setStatus("success");
    } catch (err) {
      log.error({ err }, "Network error during setup");
      setErrorMsg("Network error — could not reach the server");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configure Billing</h1>
        <p className="mt-2 text-sm text-gray-500">
          Connect your Stripe account to this TodoApp demo. Your keys are sent
          directly to the billing service and stored encrypted — they are never
          logged or stored in the browser.
        </p>
      </div>

      {status === "success" ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 space-y-3">
          <p className="font-semibold text-green-800">Configuration saved!</p>
          <p className="text-sm text-green-700">
            Your Stripe keys and plans are now active. Register a new account on
            the{" "}
            <a href="/login" className="underline">
              login page
            </a>{" "}
            to try the billing flow.
          </p>
          <button
            onClick={() => setStatus("idle")}
            className="text-sm text-green-700 underline"
          >
            Configure again
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Stripe credentials */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Stripe credentials
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secret key{" "}
                <span className="text-gray-400 font-normal">
                  (sk_test_... or sk_live_...)
                </span>
              </label>
              <input
                type="password"
                required
                placeholder="sk_test_..."
                value={stripeSecretKey}
                onChange={(e) => setStripeSecretKey(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Publishable key{" "}
                <span className="text-gray-400 font-normal">
                  (pk_test_... or pk_live_...)
                </span>
              </label>
              <input
                type="text"
                required
                placeholder="pk_test_..."
                value={stripePublishableKey}
                onChange={(e) => setStripePublishableKey(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Webhook signing secret{" "}
                <span className="text-gray-400 font-normal">(whsec_...)</span>
              </label>
              <input
                type="password"
                required
                placeholder="whsec_..."
                value={stripeWebhookSecret}
                onChange={(e) => setStripeWebhookSecret(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Create a webhook in the{" "}
                <a
                  href="https://dashboard.stripe.com/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Stripe dashboard
                </a>{" "}
                pointing to{" "}
                <code className="bg-gray-100 px-1 rounded">
                  {typeof window !== "undefined"
                    ? `${window.location.origin.replace("example-app", "lyrian-stripe")}/api/billing/webhook/example_app`
                    : "/api/billing/webhook/example_app"}
                </code>{" "}
                and subscribe to: checkout.session.completed,
                customer.subscription.updated, customer.subscription.deleted,
                invoice.payment_failed, invoice.payment_succeeded.
              </p>
            </div>
          </section>

          {/* Plans JSON */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Pricing plans
              </h2>
              {jsonError && (
                <span className="text-xs text-red-600 font-medium">
                  {jsonError}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Paste your plans as a JSON array. Use{" "}
              <code className="bg-gray-100 px-1 rounded">planKey</code> values:{" "}
              <code className="bg-gray-100 px-1 rounded">basic</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">pro</code>, or{" "}
              <code className="bg-gray-100 px-1 rounded">paygo</code>. Get{" "}
              <code className="bg-gray-100 px-1 rounded">stripeProductId</code>{" "}
              and{" "}
              <code className="bg-gray-100 px-1 rounded">stripePriceId</code>{" "}
              from your{" "}
              <a
                href="https://dashboard.stripe.com/products"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Stripe products
              </a>
              .
            </p>
            <textarea
              required
              rows={16}
              value={plansJson}
              onChange={(e) => {
                setPlansJson(e.target.value);
                validateJson(e.target.value);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-mono outline-none focus:ring-1 ${
                jsonError
                  ? "border-red-400 focus:border-red-400 focus:ring-red-400"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
            />
          </section>

          {status === "error" && errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={status === "loading" || !!jsonError}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {status === "loading" ? "Saving…" : "Save configuration"}
          </button>
        </form>
      )}
    </div>
  );
}
