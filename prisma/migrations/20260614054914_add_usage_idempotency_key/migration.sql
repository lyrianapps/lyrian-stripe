-- CreateTable
CREATE TABLE "UsageIdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "billingCustomerId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageIdempotencyKey_key_key" ON "UsageIdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "UsageIdempotencyKey_createdAt_idx" ON "UsageIdempotencyKey"("createdAt");
