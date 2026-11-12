-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Movement_partnershipId_clientKey_key" ON "Movement"("partnershipId", "clientKey");

