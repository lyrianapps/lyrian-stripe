"use client";

import { useState } from "react";
import { clientLogger } from "@/lib/clientLogger";

const log = clientLogger.child({ page: "setup" });

function getWebhookUrl(): string {
  if (typeof window === "undefined") return "/api/billing/webhook/example_app";
  return `${window.location.origin.replace("example-app", "lyrian-stripe")}/api/billing/webhook/example_app`;
}

const FLAT_RATE_PLANS = JSON.stringify(
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

const METERED_PLANS = JSON.stringify(
  [
    {
      planKey: "paygo",
      name: "Pay As You Go",
      description: "Billed per unit at the end of each billing period",
      price: 0,
      billingType: "metered",
      unitAmount: 4,
      stripeProductId: "prod_REPLACE_ME",
      stripePriceId: "price_REPLACE_ME",
      stripeMeterEventName: "REPLACE_WITH_YOUR_METER_EVENT",
      sortOrder: 1,
    },
  ],
  null,
  2,
);

type BillingMode = "flat_rate" | "metered";

type Status = "idle" | "loading" | "success" | "error";
type VerifyStatus = "pending" | "checking" | "done" | "failed";

interface VerifyCheck {
  ok: boolean;
  detail: string;
  count?: number;
}

interface VerifyResult {
  ok: boolean;
  checks: {
    stripeKey: VerifyCheck;
    publishableKey: VerifyCheck;
    webhookSecret: VerifyCheck;
    plans: VerifyCheck;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup guide
// ─────────────────────────────────────────────────────────────────────────────

function SetupGuide() {
  const [open, setOpen] = useState(true);
  const webhookUrl = getWebhookUrl();

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-blue-900">
          Setup guide — 4 steps
        </span>
        <svg
          className={`h-4 w-4 text-blue-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="border-t border-blue-100 px-5 pb-5 pt-4 space-y-5">
          {/* Step 1 */}
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white mt-0.5">
              1
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-blue-900">
                Get your Stripe API keys
              </p>
              <p className="text-sm text-blue-800">
                Open{" "}
                <a
                  href="https://dashboard.stripe.com/test/apikeys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Stripe Dashboard → Developers → API Keys
                </a>
                . Copy your <strong>Secret key</strong> (
                <code>sk_test_...</code>) and <strong>Publishable key</strong> (
                <code>pk_test_...</code>). Use test mode keys for this demo.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white mt-0.5">
              2
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-blue-900">
                Create your products &amp; prices in Stripe
              </p>
              <p className="text-sm text-blue-800">
                Go to{" "}
                <a
                  href="https://dashboard.stripe.com/test/products"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Stripe Dashboard → Products → Add product
                </a>
                . For each plan create a product and add a{" "}
                <strong>recurring monthly price</strong>. Note the{" "}
                <code>prod_...</code> and <code>price_...</code> IDs — you will
                paste them into the plans JSON below.
              </p>
              <p className="text-xs text-blue-600">
                Supported plan keys:{" "}
                <code className="bg-blue-100 px-1 rounded">basic</code> &amp;{" "}
                <code className="bg-blue-100 px-1 rounded">pro</code> (flat_rate
                monthly) ·{" "}
                <code className="bg-blue-100 px-1 rounded">paygo</code>{" "}
                (metered, billed per unit)
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white mt-0.5">
              3
            </span>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-blue-900">
                Create a webhook endpoint
              </p>
              <p className="text-sm text-blue-800">
                Go to{" "}
                <a
                  href="https://dashboard.stripe.com/test/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  Stripe Dashboard → Developers → Webhooks → Add endpoint
                </a>
                . Set the endpoint URL to:
              </p>
              <code className="block break-all rounded bg-blue-100 px-3 py-2 text-xs text-blue-900">
                {webhookUrl}
              </code>
              <p className="text-sm text-blue-800">
                Subscribe to these events:
              </p>
              <ul className="space-y-0.5 text-xs font-mono text-blue-700">
                <li>checkout.session.completed</li>
                <li>customer.subscription.updated</li>
                <li>customer.subscription.deleted</li>
                <li>invoice.payment_failed</li>
                <li>invoice.payment_succeeded</li>
              </ul>
              <p className="text-sm text-blue-800">
                After saving, copy the <strong>Signing secret</strong> (
                <code>whsec_...</code>).
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white mt-0.5">
              4
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-blue-900">
                Paste everything below &amp; save
              </p>
              <p className="text-sm text-blue-800">
                Fill in the three key fields and replace the{" "}
                <code>prod_REPLACE_ME</code> / <code>price_REPLACE_ME</code>{" "}
                placeholders in the plans JSON with your real IDs. Hit{" "}
                <strong>Save configuration</strong> — the verification checklist
                will confirm everything is wired up correctly.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [billingMode, setBillingMode] = useState<BillingMode>("flat_rate");
  const [plansJson, setPlansJson] = useState(FLAT_RATE_PLANS);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("pending");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  function handleBillingModeChange(mode: BillingMode) {
    setBillingMode(mode);
    setPlansJson(mode === "metered" ? METERED_PLANS : FLAT_RATE_PLANS);
    setJsonError(null);
  }

  function validateJson(val: string) {
    try {
      JSON.parse(val);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  }

  async function runVerification() {
    setVerifyStatus("checking");
    setVerifyResult(null);
    try {
      const res = await fetch("/api/setup/verify", { cache: "no-store" });
      const data = (await res.json()) as VerifyResult;
      setVerifyResult(data);
      setVerifyStatus("done");
      log.info({ ok: data.ok }, "Verification completed");
    } catch (err) {
      log.error({ err }, "Verification request failed");
      setVerifyStatus("failed");
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
          billingMode,
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
      runVerification();
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
          Connect your Stripe account to this TodoApp demo. Your keys are
          transmitted over HTTPS, encrypted at rest with AES-256-GCM, and stored
          in a private database — they are never logged or retained in the
          browser.
        </p>
      </div>

      {status === "success" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 space-y-3">
            <p className="font-semibold text-green-800">Configuration saved!</p>
            <p className="text-sm text-green-700">
              Your Stripe keys and plans are now active. Register a new account
              on the{" "}
              <a href="/login" className="underline">
                login page
              </a>{" "}
              to try the billing flow.
            </p>
            <button
              onClick={() => {
                setStatus("idle");
                setVerifyStatus("pending");
                setVerifyResult(null);
                setBillingMode("flat_rate");
                setPlansJson(FLAT_RATE_PLANS);
              }}
              className="text-sm text-green-700 underline"
            >
              Configure again
            </button>
          </div>

          {/* Verification checklist */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Configuration check
              </h2>
              {verifyStatus === "done" && (
                <button
                  onClick={runVerification}
                  className="text-xs text-blue-600 underline"
                >
                  Re-run
                </button>
              )}
            </div>

            {verifyStatus === "checking" && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg
                  className="animate-spin h-4 w-4 shrink-0 text-blue-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Verifying with Stripe…
              </div>
            )}

            {verifyStatus === "failed" && (
              <p className="text-sm text-red-600">
                Could not reach the billing service.{" "}
                <button onClick={runVerification} className="underline">
                  Retry
                </button>
              </p>
            )}

            {verifyStatus === "done" && verifyResult && (
              <ul className="space-y-2">
                {(
                  [
                    ["stripeKey", "Stripe secret key"],
                    ["publishableKey", "Stripe publishable key"],
                    ["webhookSecret", "Webhook signing secret"],
                    ["plans", "Pricing plans"],
                  ] as const
                ).map(([key, label]) => {
                  const check = verifyResult.checks[key];
                  return (
                    <li key={key} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0">
                        {check.ok ? (
                          <svg
                            className="h-4 w-4 text-green-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-4 w-4 text-red-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="text-gray-700 font-medium">{label}</span>
                      <span className="ml-auto text-gray-400 text-xs">
                        {check.detail}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <>
          <SetupGuide />
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Billing mode selector */}
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Billing model
              </h2>
              <p className="text-xs text-gray-500">
                Choose how customers will be charged. This locks the plan types
                you can configure — you cannot mix flat rate and metered plans.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    {
                      value: "flat_rate" as const,
                      label: "Flat rate",
                      desc: "Fixed monthly subscription (basic / pro)",
                    },
                    {
                      value: "metered" as const,
                      label: "Pay as you go",
                      desc: "Billed per unit at period end (paygo)",
                    },
                  ] as const
                ).map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleBillingModeChange(value)}
                    className={`rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                      billingMode === value
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${billingMode === value ? "text-blue-800" : "text-gray-800"}`}
                    >
                      {label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </section>

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
                  See Step 3 of the setup guide above for the webhook URL and
                  required events.
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
                <code className="bg-gray-100 px-1 rounded">planKey</code>{" "}
                values: <code className="bg-gray-100 px-1 rounded">basic</code>,{" "}
                <code className="bg-gray-100 px-1 rounded">pro</code>, or{" "}
                <code className="bg-gray-100 px-1 rounded">paygo</code>. Get{" "}
                <code className="bg-gray-100 px-1 rounded">
                  stripeProductId
                </code>{" "}
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
        </>
      )}
    </div>
  );
}
