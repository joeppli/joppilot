-- CreateTable
CREATE TABLE "EventDataRecord" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventDataRecord_commandId_key" ON "EventDataRecord"("commandId");

