-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'OVERHAUL', 'REBUILD');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('CAPEX', 'MAINTENANCE', 'CONSUMABLE', 'LABOR', 'FAILURE', 'WARRANTY', 'FUEL', 'DOWNTIME');

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locomotiveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerMonths" DOUBLE PRECISION,
    "triggerKm" DOUBLE PRECISION,
    "triggerHours" DOUBLE PRECISION,
    "rule" TEXT NOT NULL,
    "laborHours" DOUBLE PRECISION NOT NULL,
    "laborRatePerHour" DOUBLE PRECISION NOT NULL,
    "partsEstimate" DOUBLE PRECISION NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locomotiveId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" "CostCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_organizationId_locomotiveId_idx" ON "MaintenanceSchedule"("organizationId", "locomotiveId");

-- CreateIndex
CREATE INDEX "CostRecord_organizationId_locomotiveId_year_category_idx" ON "CostRecord"("organizationId", "locomotiveId", "year", "category");

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_locomotiveId_fkey" FOREIGN KEY ("locomotiveId") REFERENCES "Locomotive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_locomotiveId_fkey" FOREIGN KEY ("locomotiveId") REFERENCES "Locomotive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
