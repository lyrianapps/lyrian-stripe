-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('flat_rate', 'metered', 'volume');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Plan" ADD VALUE 'paygo';
ALTER TYPE "Plan" ADD VALUE 'volume';

-- AlterTable
ALTER TABLE "AppPlan" ADD COLUMN     "billingType" "BillingType" NOT NULL DEFAULT 'flat_rate',
ADD COLUMN     "freeUnitsPerMonth" INTEGER,
ADD COLUMN     "minMonthlyUnits" INTEGER,
ADD COLUMN     "stripeMeterEventName" TEXT,
ADD COLUMN     "unitAmount" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "stripeSubscriptionItemId" TEXT;

-- CreateTable
CREATE TABLE "MonthlyUsage" (
    "id" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "unitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyUsage_appId_yearMonth_idx" ON "MonthlyUsage"("appId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyUsage_billingCustomerId_yearMonth_key" ON "MonthlyUsage"("billingCustomerId", "yearMonth");

-- AddForeignKey
ALTER TABLE "MonthlyUsage" ADD CONSTRAINT "MonthlyUsage_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
