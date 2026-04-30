"use client";

/**
 * error.tsx — catches errors thrown inside any route within the root layout
 * (e.g. a page component crash, an API route that somehow throws to the renderer).
 *
 * For errors during module init (env.ts) see global-error.tsx.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white border border-gray-200 rounded-lg p-8">
        <h1 className="text-xl font-bold text-red-600 mb-3">
          Something went wrong
        </h1>
        <p className="text-gray-600 mb-6">
          An unexpected error occurred. You can try again or contact support if
          the problem persists.
        </p>

        {isDev && error.message && (
          <pre className="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-700 whitespace-pre-wrap wrap-break-word mb-6">
            {error.message}
            {error.digest ? `\n\nDigest: ${error.digest}` : ""}
          </pre>
        )}

        {!isDev && error.digest && (
          <p className="text-sm text-gray-500 mb-6">
            Error ID: <code className="font-mono">{error.digest}</code>
          </p>
        )}

        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
