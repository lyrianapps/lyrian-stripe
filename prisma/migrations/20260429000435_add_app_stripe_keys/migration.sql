-- AlterTable
ALTER TABLE "App" ADD COLUMN     "stripePublishableKey" TEXT,
ADD COLUMN     "stripeSecretKey" TEXT,
ADD COLUMN     "stripeWebhookSecret" TEXT;
