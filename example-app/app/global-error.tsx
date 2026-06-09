"use client";

/**
 * global-error.tsx — catches errors that escape the root layout, including
 * crashes during module initialisation (e.g. env.ts validation failures).
 *
 * Must include <html> and <body> — Tailwind is unavailable at this level.
 */

const KNOWN_ERRORS: Array<{
  match: (msg: string) => boolean;
  title: string;
  description: string;
}> = [
  {
    match: (msg) => msg.includes("Invalid environment variables"),
    title: "Configuration error",
    description:
      "The app could not start because one or more environment variables are missing or invalid. Check the deployment configuration.",
  },
  {
    match: (msg) =>
      msg.includes("connect ECONNREFUSED") ||
      msg.includes("Can't reach database"),
    title: "Service unavailable",
    description:
      "The app could not connect to a required service. Please try again in a moment.",
  },
  {
    match: (msg) =>
      msg.includes("BILLING_API_URL") || msg.includes("BILLING_API_KEY"),
    title: "Billing service not configured",
    description:
      "The billing service connection is not configured. Set BILLING_API_URL and BILLING_API_KEY in your environment.",
  },
];

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  const isDev = process.env.NODE_ENV !== "production";
  const known = KNOWN_ERRORS.find((e) => e.match(error.message ?? ""));

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#f9fafb",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 32,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: known ? "#92400e" : "#dc2626",
              marginBottom: 8,
              marginTop: 0,
            }}
          >
            {known ? known.title : "Something went wrong"}
          </h1>
          <p style={{ fontSize: 14, color: "#4b5563", marginBottom: 20 }}>
            {known
              ? known.description
              : "An unexpected error occurred. Please try reloading the page."}
          </p>

          {isDev && error.message && (
            <pre
              style={{
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
                color: "#374151",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowX: "auto",
                marginBottom: 20,
              }}
            >
              {error.message}
              {error.digest ? `\n\nDigest: ${error.digest}` : ""}
            </pre>
          )}

          {!isDev && error.digest && (
            <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 20 }}>
              Error ID:{" "}
              <code style={{ fontFamily: "monospace" }}>{error.digest}</code>
            </p>
          )}

          {reset && (
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          )}
        </div>
      </body>
    </html>
  );
}
