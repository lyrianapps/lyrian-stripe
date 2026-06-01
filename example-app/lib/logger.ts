import pino from "pino";

export const logger = pino(
  {
    level:
      process.env.LOG_LEVEL ??
      (process.env.NODE_ENV === "production" ? "info" : "debug"),
    base: { service: "lyrian-example-app" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["*.apiKey", "*.password"],
      censor: "[redacted]",
    },
  },
  process.env.NODE_ENV !== "production"
    ? pino.transport({ target: "pino-pretty", options: { colorize: true } })
    : undefined,
);
