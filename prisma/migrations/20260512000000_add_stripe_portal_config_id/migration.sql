-- Add stripePortalConfigId to App.
-- This caches the Stripe Customer Portal configuration ID (bpc_...) that we
-- create per-app with subscription_cancel disabled. Storing it avoids
-- creating a new Stripe Portal Configuration object on every portal visit.
ALTER TABLE "App" ADD COLUMN "stripePortalConfigId" TEXT;
