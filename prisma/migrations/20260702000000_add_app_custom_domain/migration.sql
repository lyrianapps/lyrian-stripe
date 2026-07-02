-- AlterTable
ALTER TABLE "App" ADD COLUMN "customDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "App_customDomain_key" ON "App"("customDomain");
