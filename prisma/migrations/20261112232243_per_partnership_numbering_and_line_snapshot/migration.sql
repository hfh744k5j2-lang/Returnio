-- AlterTable
ALTER TABLE "Movement" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE "Movement_number_seq";

-- AlterTable
ALTER TABLE "MovementLine" ADD COLUMN     "reusable" BOOLEAN NOT NULL,
ADD COLUMN     "weightKg" DECIMAL(10,3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Movement_partnershipId_number_key" ON "Movement"("partnershipId", "number");

