"use client";

import { useEffect } from "react";
import { clientLogger } from "@/lib/clientLogger";

const log = clientLogger.child({ component: "ErrorBoundary" });

/**
 * error.tsx — catches errors thrown inside any route within the root layout.
 * Rendered when a page component or server action throws an unhandled error.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV !== "production";

  useEffect(() => {
    log.error(
      { message: error.message, digest: error.digest },
      "Unhandled page error",
    );
  }, [error]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
        <h1 className="text-xl font-bold text-red-600 mb-3">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          An unexpected error occurred. You can try again or reload the page if
          the problem persists.
        </p>

        {isDev && error.message && (
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 whitespace-pre-wrap wrap-break-word mb-6 overflow-auto">
            {error.message}
            {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          </pre>
        )}

        {!isDev && error.digest && (
          <p className="text-xs text-gray-400 mb-6">
            Error ID: <code className="font-mono">{error.digest}</code>
          </p>
        )}

        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
