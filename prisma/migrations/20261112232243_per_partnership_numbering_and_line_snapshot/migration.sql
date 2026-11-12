-- Číslo pohybu v rámci partnerství (místo globální sekvence)
ALTER TABLE "Movement" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE "Movement_number_seq";
-- přečíslování existujících pohybů v rámci partnerství
UPDATE "Movement" m SET "number" = x.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "partnershipId" ORDER BY "createdAt", "id") AS rn FROM "Movement") x
WHERE m."id" = x."id";

-- Snímek hmotnosti a vratnosti v řádku pohybu (doplnění z typu obalu u existujících dat)
ALTER TABLE "MovementLine" ADD COLUMN "reusable" BOOLEAN,
ADD COLUMN "weightKg" DECIMAL(10,3);
UPDATE "MovementLine" l SET "reusable" = t."reusable", "weightKg" = t."weightKg"
FROM "PackagingType" t WHERE t."id" = l."packagingTypeId";
ALTER TABLE "MovementLine" ALTER COLUMN "reusable" SET NOT NULL,
ALTER COLUMN "weightKg" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Movement_partnershipId_number_key" ON "Movement"("partnershipId", "number");
