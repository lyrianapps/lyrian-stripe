/*
  Warnings:

  - Changed the type of `status` on the `Subscription` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete');

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "status",
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL;

-- CreateTable
CREATE TABLE "BillingSession" (
    "id" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "BillingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingSession_billingCustomerId_idx" ON "BillingSession"("billingCustomerId");

-- CreateIndex
CREATE INDEX "BillingSession_appId_externalUserId_idx" ON "BillingSession"("appId", "externalUserId");

-- AddForeignKey
ALTER TABLE "BillingSession" ADD CONSTRAINT "BillingSession_billingCustomerId_fkey" FOREIGN KEY ("billingCustomerId") REFERENCES "BillingCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
