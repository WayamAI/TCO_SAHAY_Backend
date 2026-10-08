-- CreateTable
CREATE TABLE "TcoRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locomotiveId" TEXT NOT NULL,
    "horizonYears" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TcoRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TcoRun_organizationId_locomotiveId_idx" ON "TcoRun"("organizationId", "locomotiveId");

-- AddForeignKey
ALTER TABLE "TcoRun" ADD CONSTRAINT "TcoRun_locomotiveId_fkey" FOREIGN KEY ("locomotiveId") REFERENCES "Locomotive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TcoRun" ADD CONSTRAINT "TcoRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
