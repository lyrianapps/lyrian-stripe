-- CreateTable
CREATE TABLE "AppPlan" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "interval" "BillingInterval" NOT NULL DEFAULT 'month',
    "stripeProductId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppPlan_appId_idx" ON "AppPlan"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "AppPlan_appId_planKey_key" ON "AppPlan"("appId", "planKey");

-- AddForeignKey
ALTER TABLE "AppPlan" ADD CONSTRAINT "AppPlan_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
