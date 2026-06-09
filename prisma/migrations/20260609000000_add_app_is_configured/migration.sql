c-- Add isConfigured flag to App table.
-- Defaults to false so existing apps are treated as unconfigured until
-- their credentials are verified via GET /api/apps/[appId]/verify.

ALTER TABLE "App" ADD COLUMN "isConfigured" BOOLEAN NOT NULL DEFAULT false;
