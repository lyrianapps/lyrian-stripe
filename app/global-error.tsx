"use client";

/**
 * global-error.tsx — catches errors that escape the root layout, including
 * crashes during module initialisation (e.g. env.ts validation failures).
 *
 * Must include <html> and <body> since it replaces the entire root layout.
 * Uses inline styles — Tailwind is unavailable at this level.
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
      "The server could not start because one or more environment variables are missing or invalid. Check the application logs for details.",
  },
  {
    match: (msg) =>
      msg.includes("connect ECONNREFUSED") ||
      msg.includes("Can't reach database"),
    title: "Database connection error",
    description:
      "The server could not connect to the database. The database may be unavailable or the connection string may be incorrect.",
  },
  {
    match: (msg) =>
      msg.includes("JWT") ||
      msg.includes("JsonWebTokenError") ||
      msg.includes("invalid signature"),
    title: "Authentication error",
    description:
      "A authentication configuration problem occurred. Check that SAAS_JWT_SECRET is set correctly.",
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
          fontFamily: "system-ui, sans-serif",
          background: "#fafafa",
          margin: 0,
          padding: "48px 24px",
          color: "#111",
        }}
      >
        <div
          style={{
            maxWidth: 680,
            margin: "0 auto",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 32,
          }}
        >
          {/* Title */}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#dc2626",
              marginTop: 0,
              marginBottom: 12,
            }}
          >
            {known?.title ?? "Something went wrong"}
          </h1>

          {/* Description */}
          <p style={{ color: "#374151", marginBottom: 20, lineHeight: 1.6 }}>
            {known?.description ??
              "An unexpected error occurred. Please try again or contact support if the problem persists."}
          </p>

          {/* Dev: always show full error */}
          {isDev && error.message && (
            <pre
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 6,
                padding: 16,
                fontSize: 13,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#7f1d1d",
                marginBottom: 20,
              }}
            >
              {error.message}
              {error.digest ? `\n\nDigest: ${error.digest}` : ""}
            </pre>
          )}

          {/* Production: show digest only (safe to share with support) */}
          {!isDev && error.digest && (
            <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>
              Error ID:{" "}
              <code
                style={{
                  fontFamily: "monospace",
                  background: "#f3f4f6",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {error.digest}
              </code>
            </p>
          )}

          {/* Reset button — not useful for init crashes but helps page-level errors */}
          {reset && (
            <button
              onClick={reset}
              style={{
                padding: "8px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
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
