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
      // A genuine rate-limit rejection from rate-limiter-flexible always has
      // both msBeforeNext and remainingPoints on the thrown object.
      // Anything else (DB connection failure, table not ready, idle pool
      // reconnect error, etc.) is an infrastructure problem — fail open so
      // users aren't blocked by a transient backend issue.
      if (
        error &&
        typeof error === "object" &&
        "msBeforeNext" in error &&
        "remainingPoints" in error
      ) {
        // Legitimate rate-limit — let the middleware return 429
        throw error;
      }

      // Infrastructure error — log and allow the request through
      console.warn(
        `[RateLimit] ${this.keyPrefix}: Infrastructure error (fail-open), allowing request through`,
        error,
      );
      return { remainingPoints: this.points - 1, msBeforeNext: 60000 };
    }
  }
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

  // Portal - session creation: 60 req/min (keyed per-user via JWT sub)
  portal: createRateLimiter("portal", 60, 60),

  // Status checks - server-to-server, keyed per user; 300 req/min gives
  // each user (or the whole app when externalUserId is absent) ~5 req/sec
  // of headroom. The Threads App should also cache responses for 30-60s
  // on its side to avoid needless calls.
  status: createRateLimiter("status", 300, 60),

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
 * Extract client identifier for the portal endpoint.
 * Peeks at the JWT `token` query param and uses its `sub` claim as the key
 * so each individual user gets their own rate-limit bucket instead of
 * everyone from the same IP sharing one.
 */
export function getPortalIdentifier(request: Request): string {
  try {
    const url = new URL((request as { url: string }).url);
    const token = url.searchParams.get("token");
    if (token) {
      // Decode without verifying — verification happens in the handler.
      // We only need the sub claim to form a stable per-user key.
      const [, payloadB64] = token.split(".");
      if (payloadB64) {
        const payload = JSON.parse(
          Buffer.from(payloadB64, "base64url").toString("utf8"),
        ) as { sub?: string; iss?: string };
        if (payload.sub && payload.iss) {
          return `portal:${hashString(payload.iss)}:${hashString(payload.sub)}`;
        }
      }
    }
  } catch {
    // Fall through to IP-based identifier
  }
  return getClientIdentifier(request);
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
