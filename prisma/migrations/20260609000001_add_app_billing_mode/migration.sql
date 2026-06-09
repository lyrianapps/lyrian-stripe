-- Add billingMode to App table.
-- Declares whether the app uses flat_rate or metered billing.
-- All plans configured for the app must match this mode.
-- NULL = not yet declared (legacy apps).

ALTER TABLE "App" ADD COLUMN "billingMode" "BillingType";
