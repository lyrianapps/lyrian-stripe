import { RateLimiterPostgres, RateLimiterMemory } from "rate-limiter-flexible";
import { Pool } from "pg";
import { env } from "@/env";

// Check if we're in a test environment
const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST;

// Create a dedicated pool for rate limiting (only in non-test environments)
const rateLimitPool = isTestEnv
  ? null
  : new Pool({
      connectionString: env.DATABASE_URL,
      max: 5, // Small pool just for rate limiting
    });

// Rate limiter will auto-create the table on first use
const createRateLimiter = (
  keyPrefix: string,
  points: number,
  durationSeconds: number,
) => {
  // In test environment, use in-memory limiter with high limits to avoid blocking tests
  if (isTestEnv) {
    return new RateLimiterMemory({
      keyPrefix,
      points: 10000, // Very high limit for tests
      duration: durationSeconds,
    });
  }

  return new RateLimiterPostgres({
    storeClient: rateLimitPool!,
    keyPrefix,
    points, // Number of requests
    duration: durationSeconds, // Per X seconds
    tableName: "rate_limits", // Shared table for all limiters
    tableCreated: false, // Will be created automatically
  });
};

/**
 * Rate limiter presets for different endpoint types
 */
export const rateLimiters = {
  // Checkout - expensive Stripe operation: 10 req/min
  checkout: createRateLimiter("checkout", 10, 60),

  // Cancel - sensitive operation: 5 req/min
  cancel: createRateLimiter("cancel", 5, 60),

  // Portal - session creation: 20 req/min
  portal: createRateLimiter("portal", 20, 60),

  // Status checks - more lenient for polling: 60 req/min
  status: createRateLimiter("status", 60, 60),

  // Webhooks - Stripe may retry, be generous: 100 req/min
  webhook: createRateLimiter("webhook", 100, 60),

  // Cron jobs - should be rare: 10 req/min
  cron: createRateLimiter("cron", 10, 60),
};

export type RateLimiterKey = keyof typeof rateLimiters;

/**
 * Extract client identifier from request
 * Prefers API key > forwarded IP > direct IP
 */
export function getClientIdentifier(request: Request): string {
  // Check for API key first (most reliable for server-to-server)
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    // Hash the API key to avoid storing it directly
    return `apikey:${hashString(apiKey)}`;
  }

  // Check for forwarded IP (behind proxy/load balancer)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return `ip:${forwarded.split(",")[0].trim()}`;
  }

  // Check CF-Connecting-IP (Cloudflare)
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    return `ip:${cfIp}`;
  }

  // Fallback
  return `unknown:${Date.now()}`;
}

/**
 * Simple string hash for API key anonymization
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Create standard rate limit headers
 */
export function rateLimitHeaders(
  limit: number,
  remaining: number,
  resetMs: number,
): HeadersInit {
  return {
    "X-RateLimit-Limit": limit.toString(),
    "X-RateLimit-Remaining": Math.max(0, remaining).toString(),
    "X-RateLimit-Reset": Math.ceil(resetMs / 1000).toString(),
  };
}
