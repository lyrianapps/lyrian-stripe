import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level}: ${message}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

export function logError(error: unknown, context?: string) {
  if (error instanceof Error) {
    logger.error(
      `${context ? `[${context}] ` : ""}${error.message}\n${error.stack}`,
    );
  } else {
    logger.error(`${context ? `[${context}] ` : ""}${String(error)}`);
  }
}
