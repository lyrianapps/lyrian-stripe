import { ZodError } from "zod";

type ErrorResponse = {
  status: number;
  body: Record<string, unknown>;
};

type ErrorHandler = {
  match: (err: unknown) => boolean;
  handle: (err: unknown) => ErrorResponse;
};

/** Registry of error handlers — add new handlers here to extend behavior. */
const handlers: ErrorHandler[] = [
  {
    // Internal marker thrown when we detect a restricted key
    match: (err) =>
      err instanceof Error && err.message?.startsWith?.("RESTRICTED_KEY"),
    handle: () => ({
      status: 403,
      body: {
        error:
          "Stripe secret key is restricted or missing. Use a full secret key (sk_...) with subscription write permissions.",
      },
    }),
  },
  {
    // Stripe permission error messages (external API response)
    match: (err) =>
      err instanceof Error &&
      /does not have the required permissions/i.test(err.message),
    handle: () => ({
      status: 403,
      body: {
        error:
          "Stripe key does not have required permissions. Use a full secret key (sk_...) with subscription write permissions.",
      },
    }),
  },
  {
    // Validation errors (example extension)
    match: (err) => err instanceof ZodError,
    handle: (err) => ({
      status: 400,
      body: { error: "Invalid request", details: (err as ZodError).flatten() },
    }),
  },
];

/**
 * Returns an ErrorResponse for known errors, or null if the error isn't handled.
 * Add new handlers to `handlers` to extend without modifying callers.
 */
export function getKnownErrorResponse(err: unknown): ErrorResponse | null {
  for (const h of handlers) {
    try {
      if (h.match(err)) return h.handle(err);
    } catch (e) {
      // don't allow a handler to throw and break error processing
      // fall through to next handler
      // eslint-disable-next-line no-console
      console.warn("error handler threw", e);
    }
  }
  return null;
}

export type { ErrorResponse };
