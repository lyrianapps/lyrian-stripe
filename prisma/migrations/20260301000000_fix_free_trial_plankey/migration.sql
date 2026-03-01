-- Fix planKey: change 'free' to 'free_trial' to match Plan enum
UPDATE "AppPlan" SET "planKey" = 'free_trial' WHERE "planKey" = 'free';
