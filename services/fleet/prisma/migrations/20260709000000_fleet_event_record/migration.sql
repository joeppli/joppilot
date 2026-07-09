-- Append-only audit records for the fleet workflows (ICD §7 step 4, LEG-03/04).
-- audit-7 finding 1: checklist creation / item verification / confirmation and
-- mission transitions become event records; DEV-17 tracks the schema split.

-- CreateTable
CREATE TABLE "FleetEventRecord" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FleetEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FleetEventRecord_correlationId_idx" ON "FleetEventRecord"("correlationId");

-- CreateIndex
CREATE INDEX "FleetEventRecord_vehicleId_idx" ON "FleetEventRecord"("vehicleId");
