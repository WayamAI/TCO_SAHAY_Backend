-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "fuelMultiplier" DOUBLE PRECISION NOT NULL,
    "wearMultiplier" DOUBLE PRECISION NOT NULL,
    "maintenanceFreqMultiplier" DOUBLE PRECISION NOT NULL,
    "failureProbMultiplier" DOUBLE PRECISION NOT NULL,
    "annualKm" DOUBLE PRECISION NOT NULL,
    "annualHours" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "OperatingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locomotive" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "operatingProfileId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "horsepower" DOUBLE PRECISION NOT NULL,
    "purchaseCost" DOUBLE PRECISION NOT NULL,
    "commissionYear" INTEGER NOT NULL,
    "plannedLifeYears" INTEGER NOT NULL,
    "annualKm" DOUBLE PRECISION NOT NULL,
    "annualHours" DOUBLE PRECISION NOT NULL,
    "fuelType" TEXT NOT NULL,
    "fuelCostPerUnit" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "currentHealthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "availabilityPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Locomotive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locomotiveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,

    CONSTRAINT "SystemNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchaseCost" DOUBLE PRECISION NOT NULL,
    "replacementCost" DOUBLE PRECISION NOT NULL,
    "lifeYears" DOUBLE PRECISION NOT NULL,
    "pmTriggerMonths" DOUBLE PRECISION,
    "pmTriggerKm" DOUBLE PRECISION,
    "pmTriggerHours" DOUBLE PRECISION,
    "mtbfHours" DOUBLE PRECISION NOT NULL,
    "weibullBeta" DOUBLE PRECISION NOT NULL,
    "weibullEta" DOUBLE PRECISION NOT NULL,
    "mttrHours" DOUBLE PRECISION NOT NULL,
    "warrantyYears" DOUBLE PRECISION NOT NULL,
    "laborCostPct" DOUBLE PRECISION NOT NULL,
    "failureImpact" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currentHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downtimeCostPerDay" DOUBLE PRECISION NOT NULL,
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentDependency" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "dependsOnComponentId" TEXT NOT NULL,

    CONSTRAINT "ComponentDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fleet_organizationId_idx" ON "Fleet"("organizationId");

-- CreateIndex
CREATE INDEX "OperatingProfile_organizationId_idx" ON "OperatingProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Locomotive_organizationId_fleetId_idx" ON "Locomotive"("organizationId", "fleetId");

-- CreateIndex
CREATE INDEX "SystemNode_organizationId_locomotiveId_idx" ON "SystemNode"("organizationId", "locomotiveId");

-- CreateIndex
CREATE INDEX "Assembly_organizationId_systemNodeId_idx" ON "Assembly"("organizationId", "systemNodeId");

-- CreateIndex
CREATE INDEX "Component_organizationId_assemblyId_idx" ON "Component"("organizationId", "assemblyId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentDependency_componentId_dependsOnComponentId_key" ON "ComponentDependency"("componentId", "dependsOnComponentId");

-- AddForeignKey
ALTER TABLE "Locomotive" ADD CONSTRAINT "Locomotive_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locomotive" ADD CONSTRAINT "Locomotive_operatingProfileId_fkey" FOREIGN KEY ("operatingProfileId") REFERENCES "OperatingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNode" ADD CONSTRAINT "SystemNode_locomotiveId_fkey" FOREIGN KEY ("locomotiveId") REFERENCES "Locomotive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_systemNodeId_fkey" FOREIGN KEY ("systemNodeId") REFERENCES "SystemNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentDependency" ADD CONSTRAINT "ComponentDependency_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentDependency" ADD CONSTRAINT "ComponentDependency_dependsOnComponentId_fkey" FOREIGN KEY ("dependsOnComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
