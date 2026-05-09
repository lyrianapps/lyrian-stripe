-- Create the rate_limits table used by rate-limiter-flexible (RateLimiterPostgres).
-- Schema matches what rate-limiter-flexible expects, see:
-- https://github.com/animir/node-rate-limiter-flexible/blob/main/lib/RateLimiterPostgres.js
--
-- We create this manually (rather than letting rate-limiter-flexible auto-create
-- on first use) because the auto-create can fail silently in some deployment
-- environments, leaving every request to hit "Table is not created yet" and
-- fall through to fail-open mode (noisy logs, wasted DB queries).
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" varchar(255) PRIMARY KEY,
  "points" integer NOT NULL DEFAULT 0,
  "expire" bigint
);
