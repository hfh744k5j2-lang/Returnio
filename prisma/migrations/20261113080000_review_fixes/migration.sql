-- AlterTable
ALTER TABLE "PackagingType" ADD COLUMN     "sharedWithPartners" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorCompanyId" TEXT;

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorCompanyId_fkey" FOREIGN KEY ("actorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Dopočet pro existující záznamy: u akcí uživatele je "companyId" záznamu firma, za kterou jednal
-- (služby zapisují ctx.companyId). Neodvozujeme z aktuální firmy uživatele – ta se mohla změnit.
UPDATE "AuditLog" SET "actorCompanyId" = "companyId"
WHERE "userId" IS NOT NULL AND "companyId" IS NOT NULL AND "actorCompanyId" IS NULL;

-- Auditní stopa je append-only i na úrovni databáze: DELETE je zakázán vždy, UPDATE také.
-- Jediná výjimka: seed ukázkových dat smí v transakci se SET LOCAL obalbook.audit_backdate = 'on'
-- posunout čas záznamu (createdAt) do minulosti – nic jiného.
CREATE OR REPLACE FUNCTION obalbook_audit_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('obalbook.audit_backdate', true) = 'on'
     AND (to_jsonb(NEW) - 'createdAt') = (to_jsonb(OLD) - 'createdAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog je jen pro zápis (% není povolen).', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION obalbook_audit_append_only();
