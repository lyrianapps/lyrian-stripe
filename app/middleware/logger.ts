import pino from "pino";

export const logger = pino(
  {
    level:
      process.env.LOG_LEVEL ??
      (process.env.NODE_ENV === "production" ? "info" : "debug"),
    base: { service: "lyrian-stripe" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.password",
        "*.apiKey",
        "*.stripeSecretKey",
        "*.stripePublishableKey",
        "*.stripeWebhookSecret",
        "*.resendApiKey",
      ],
      censor: "[redacted]",
    },
  },
  process.env.NODE_ENV !== "production"
    ? pino.transport({ target: "pino-pretty", options: { colorize: true } })
    : undefined,
);

export function logError(error: unknown, context?: string) {
  if (error instanceof Error) {
    logger.error(
      { err: error, context },
      `${context ? `[${context}] ` : ""}${error.message}`,
    );
  } else {
    logger.error(
      { context },
      `${context ? `[${context}] ` : ""}${String(error)}`,
    );
  }
}

/**
 * Extract error message from unknown error type
 * Useful for logging or displaying errors safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
