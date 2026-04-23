import { NextRequest, NextResponse } from "next/server";
import {
  rateLimiters,
  RateLimiterKey,
  getClientIdentifier,
  rateLimitHeaders,
} from "@/lib/rateLimit";

/**
 * Higher-order function that wraps an API handler with rate limiting
 *
 * @param limiterKey - Which rate limiter preset to use
 * @param handler - The API handler to wrap
 * @param identifierFn - Optional custom function to derive the rate limit key (defaults to getClientIdentifier)
 * @returns Wrapped handler with rate limiting
 */
export function withRateLimit<T extends NextRequest>(
  limiterKey: RateLimiterKey,
  handler: (req: T) => Promise<NextResponse>,
  identifierFn: (req: Request) => string = getClientIdentifier,
): (req: T) => Promise<NextResponse> {
  const limiter = rateLimiters[limiterKey];

  return async (req: T): Promise<NextResponse> => {
    const identifier = identifierFn(req);

    try {
      const result = await limiter.consume(identifier);

      // Request allowed - call the handler
      const response = await handler(req);

      // Add rate limit headers to response
      const headers = new Headers(response.headers);
      const limitHeaders = rateLimitHeaders(
        limiter.points,
        result.remainingPoints,
        result.msBeforeNext,
      );
      Object.entries(limitHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (rejRes) {
      // Rate limit exceeded
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rlResult = rejRes as any;
      const retryAfter = Math.ceil(rlResult.msBeforeNext / 1000) || 60;

      return NextResponse.json(
        {
          error: "Too many requests",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(
              limiter.points,
              0,
              rlResult.msBeforeNext || 60000,
            ),
            "Retry-After": retryAfter.toString(),
          },
        },
      );
    }
  };
}

/**
 * Check rate limit without wrapping a handler
 * Useful for routes that can't use the HOF pattern (like redirects)
 */
export async function checkRateLimit(
  request: Request,
  limiterKey: RateLimiterKey,
  identifierFn: (req: Request) => string = getClientIdentifier,
): Promise<{ allowed: boolean; retryAfter?: number; headers: HeadersInit }> {
  const limiter = rateLimiters[limiterKey];
  const identifier = identifierFn(request);

  try {
    const result = await limiter.consume(identifier);
    return {
      allowed: true,
      headers: rateLimitHeaders(
        limiter.points,
        result.remainingPoints,
        result.msBeforeNext,
      ),
    };
  } catch (rejRes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlResult = rejRes as any;
    const retryAfter = Math.ceil(rlResult.msBeforeNext / 1000) || 60;

    return {
      allowed: false,
      retryAfter,
      headers: {
        ...rateLimitHeaders(limiter.points, 0, rlResult.msBeforeNext || 60000),
        "Retry-After": retryAfter.toString(),
      },
    };
  }
}
