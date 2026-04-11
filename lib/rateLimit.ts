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

// Track initialization state to prevent race conditions on startup
let postgresLimiterReady: Promise<void> | null = null;
let isInitialized = false;

/**
 * Wrapper that handles Postgres rate limiter initialization gracefully.
 * During initialization (first few requests on startup), requests are allowed through
 * to prevent "Too many requests" errors while the rate limit table is being created.
 */
class SafeRateLimiter {
  private limiter: RateLimiterPostgres | RateLimiterMemory;
  private keyPrefix: string;
  public points: number;

  constructor(
    limiter: RateLimiterPostgres | RateLimiterMemory,
    keyPrefix: string,
    points: number,
  ) {
    this.limiter = limiter;
    this.keyPrefix = keyPrefix;
    this.points = points;
  }

  async consume(key: string, pointsToConsume = 1) {
    // If not initialized yet, allow the request through
    // This prevents blocking during table creation
    if (!isInitialized && postgresLimiterReady) {
      try {
        // Wait briefly for initialization, but don't block too long
        await Promise.race([
          postgresLimiterReady,
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
      } catch {
        // If initialization fails, allow request through
        return { remainingPoints: this.points - 1, msBeforeNext: 60000 };
      }
    }

    try {
      return await this.limiter.consume(key, pointsToConsume);
    } catch (error) {
      // If this is an initialization error (table not ready), allow the request
      if (!isInitialized && isInitializationError(error)) {
        console.warn(
          `[RateLimit] ${this.keyPrefix}: Allowing request during initialization`,
        );
        return { remainingPoints: this.points - 1, msBeforeNext: 60000 };
      }
      // Otherwise, it's a legitimate rate limit rejection
      throw error;
    }
  }
}

/**
 * Check if an error is related to rate limiter initialization
 */
function isInitializationError(error: unknown): boolean {
  if (error && typeof error === "object") {
    // RateLimiterPostgres throws with msBeforeNext when rate limited
    // Initialization errors won't have this property or will have different error structure
    const hasRateLimitProps =
      "msBeforeNext" in error && "remainingPoints" in error;
    return !hasRateLimitProps;
  }
  return true;
}

// Initialize the Postgres rate limiter table on startup
function initializePostgresLimiter(limiter: RateLimiterPostgres): void {
  if (postgresLimiterReady) return;

  postgresLimiterReady = new Promise<void>((resolve) => {
    // Perform a dummy consume to trigger table creation
    limiter
      .consume("__init__", 0)
      .then(() => {
        isInitialized = true;
        resolve();
      })
      .catch(() => {
        // Table might already exist or there's an error - either way, mark as ready
        isInitialized = true;
        resolve();
      });
  });
}

const createRateLimiter = (
  keyPrefix: string,
  points: number,
  durationSeconds: number,
): SafeRateLimiter | RateLimiterMemory => {
  // In test environment, use in-memory limiter with high limits to avoid blocking tests
  if (isTestEnv) {
    return new RateLimiterMemory({
      keyPrefix,
      points: 10000, // Very high limit for tests
      duration: durationSeconds,
    });
  }

  const limiter = new RateLimiterPostgres({
    storeClient: rateLimitPool!,
    keyPrefix,
    points, // Number of requests
    duration: durationSeconds, // Per X seconds
    tableName: "rate_limits", // Shared table for all limiters
    tableCreated: false, // Will be created automatically
  });

  // Trigger initialization on first limiter creation
  initializePostgresLimiter(limiter);

  return new SafeRateLimiter(limiter, keyPrefix, points);
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
 * Extract client identifier scoped per user.
 * Used for endpoints like /status that are called per-user — ensures each
 * user gets their own rate limit bucket instead of all users from one API
 * key sharing a single bucket.
 */
export function getClientIdentifierWithUser(request: Request): string {
  const base = getClientIdentifier(request);
  const url = new URL((request as { url: string }).url);
  const externalUserId = url.searchParams.get("externalUserId");
  if (externalUserId) {
    return `${base}:${hashString(externalUserId)}`;
  }
  return base;
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
