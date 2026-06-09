"use client";

/**
 * Client-side logger using pino/browser.
 *
 * pino/browser writes to the browser's console (console.info, console.warn,
 * console.error, etc.) and is safe to import from "use client" components.
 * It shares the same API as the server-side logger so call sites are identical.
 *
 * Import this in client components instead of @/lib/logger.
 */
import pino from "pino";

export const clientLogger = pino({
  level:
    typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "debug"
      : "info",
  base: { service: "lyrian-example-app-client" },
  browser: {
    // Map pino levels to the appropriate console methods
    asObject: false,
    write: {
      trace: (o) => console.debug(o),
      debug: (o) => console.debug(o),
      info: (o) => console.info(o),
      warn: (o) => console.warn(o),
      error: (o) => console.error(o),
      fatal: (o) => console.error(o),
    },
  },
});
