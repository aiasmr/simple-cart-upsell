-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'TRIAL', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('PRODUCT', 'COLLECTION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('IMPRESSION', 'CONVERSION');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentPlan" "Plan" NOT NULL DEFAULT 'FREE',
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "chargeId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" "TriggerType" NOT NULL,
    "triggerProductId" TEXT,
    "triggerCollectionId" TEXT,
    "upsellProductId" TEXT NOT NULL,
    "upsellVariantId" TEXT,
    "upsellProductData" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "cartToken" TEXT,
    "sessionId" TEXT,
    "productPrice" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Shop_shopifyDomain_idx" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Rule_shopId_isEnabled_idx" ON "Rule"("shopId", "isEnabled");

-- CreateIndex
CREATE INDEX "Rule_triggerProductId_idx" ON "Rule"("triggerProductId");

-- CreateIndex
CREATE INDEX "Rule_triggerCollectionId_idx" ON "Rule"("triggerCollectionId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_ruleId_createdAt_idx" ON "AnalyticsEvent"("shopId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_cartToken_idx" ON "AnalyticsEvent"("cartToken");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
