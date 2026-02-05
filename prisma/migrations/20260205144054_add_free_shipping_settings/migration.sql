-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "freeShippingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeShippingThreshold" DECIMAL(10,2) NOT NULL DEFAULT 50.00;
