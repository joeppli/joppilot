-- SEC-06: dedicated correlation-id column on the EDR (nullable — pre-M2-4
-- rows have none; every new row carries one).
ALTER TABLE "EventDataRecord" ADD COLUMN "correlationId" TEXT;

-- CreateIndex
CREATE INDEX "EventDataRecord_correlationId_idx" ON "EventDataRecord"("correlationId");

-- SEC-04: operator ↔ vehicle assignment — authority valid only for assigned
-- vehicles. Revocation deactivates in place (history preserved, LEG-05).
CREATE TABLE "VehicleAssignment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleAssignment_vehicleId_operatorId_active_idx" ON "VehicleAssignment"("vehicleId", "operatorId", "active");
