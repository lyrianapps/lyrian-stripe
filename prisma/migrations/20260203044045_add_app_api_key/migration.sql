/*
  Warnings:

  - A unique constraint covering the columns `[apiKey]` on the table `App` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "App" ADD COLUMN     "apiKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "App_apiKey_key" ON "App"("apiKey");
