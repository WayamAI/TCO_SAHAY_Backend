-- AlterTable
ALTER TABLE "TcoRun" ADD COLUMN     "scenarioId" TEXT;

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planningHorizonYears" INTEGER NOT NULL,
    "discountRate" DOUBLE PRECISION NOT NULL,
    "laborRate" DOUBLE PRECISION NOT NULL,
    "maintenanceIntervalMultiplier" DOUBLE PRECISION NOT NULL,
    "failureRateMultiplier" DOUBLE PRECISION NOT NULL,
    "warrantyExtendedYears" DOUBLE PRECISION NOT NULL,
    "fuelCostPerLiter" DOUBLE PRECISION NOT NULL,
    "inflationEnabled" BOOLEAN NOT NULL,
    "includeDowntime" BOOLEAN NOT NULL,
    "operatingProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scenario_organizationId_idx" ON "Scenario"("organizationId");

-- CreateIndex
CREATE INDEX "TcoRun_scenarioId_idx" ON "TcoRun"("scenarioId");

-- AddForeignKey
ALTER TABLE "TcoRun" ADD CONSTRAINT "TcoRun_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_operatingProfileId_fkey" FOREIGN KEY ("operatingProfileId") REFERENCES "OperatingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
