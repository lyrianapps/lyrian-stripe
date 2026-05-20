/*
  Warnings:

  - You are about to drop the `rate_limits` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "BillingCustomer" ADD COLUMN     "duplicateCardDetected" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "rate_limits";
