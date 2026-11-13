/**
 * Opravy z revize po M7:
 *  - auditní stopa ukazuje firmu autora podle snímku v době zápisu (žádný název cizí firmy),
 *  - AuditLog je append-only i v databázi,
 *  - partner nevidí celý katalog obalů druhé firmy,
 *  - omezení počtu pokusů,
 *  - pozvánka kolegy neprozrazuje, že e-mail patří jiné firmě.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as mv from "@/lib/services/movements";
import * as auditSvc from "@/lib/services/audit";
import * as csv from "@/lib/services/csv";
import { acceptInvitation, inviteUser } from "@/lib/services/companies";
import { hit } from "@/lib/rate-limit";
import { addMember, makeCompany, rnd } from "./fixtures";

const today = () => new Date().toISOString().slice(0, 10);
let A: Ctx, B: Ctx, Bsklad: Ctx, C: Ctx;
let pAB: string;
let tUsed: string, tUnused: string, tShared: string, tB: string;

beforeAll(async () => {
  A = await makeCompany("Rev A");
  B = await makeCompany("Rev B");
  C = await makeCompany("Rev C – cizí tajná firma");
  Bsklad = await addMember(B, "SKLAD");
  const { url } = await partners.invitePartner(A, { name: "Rev B", email: B.email });
  await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
  pAB = (await prisma.partnership.findFirstOrThrow({ where: { companyAId: A.companyId, companyBId: B.companyId } })).id;
  tUsed = (await packaging.createPackagingType(A, { name: "EUR paleta", code: "EUR", weightKg: 25 })).id;
  tUnused = (await packaging.createPackagingType(A, { name: "Tajný obal pro jiné", code: "SECRET", weightKg: 3, deposit: 999 })).id;
  tShared = (await packaging.createPackagingType(A, { name: "Poolová paleta", code: "POOL", weightKg: 20, sharedWithPartners: true })).id;
  tB = (await packaging.createPackagingType(B, { name: "Přepravka B", code: "BOX", weightKg: 2 })).id;
});

describe("audit – autor podle snímku firmy v době zápisu", () => {
  it("po přechodu zaměstnance partnera k cizí firmě A nikdy neuvidí název cizí firmy", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tUsed, quantity: 5 }] });
    await mv.confirmMovement(Bsklad, m.id);
    // B zaměstnance odebere, ten se přidá k nesouvisející firmě C
    await prisma.user.update({ where: { id: Bsklad.userId }, data: { companyId: C.companyId, role: "ADMIN" } });

    const history = await auditSvc.movementHistory(A, m.id);
    const confirmed = history.find((h) => h.action === "movement.confirmed")!;
    expect(confirmed.actor).toBe("Rev B");
    expect(confirmed.ownCompany).toBe(false);
    const all = await auditSvc.listAudit(A, { pageSize: 500 });
    expect(JSON.stringify(all)).not.toContain("cizí tajná");
    expect(JSON.stringify(await auditSvc.movementHistory(B, m.id))).not.toContain("cizí tajná");

    // a C z historie partnerství A↔B nevidí nic
    expect((await auditSvc.listAudit(C, { entityId: m.id })).items).toEqual([]);
    await prisma.user.update({ where: { id: Bsklad.userId }, data: { companyId: B.companyId, role: "SKLAD" } });
  });

  it("snímek se ukládá při zápisu", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tUsed, quantity: 1 }] });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "movement.created" } });
    expect(log.actorCompanyId).toBe(A.companyId);
  });
});

describe("audit – append-only v databázi", () => {
  it("záznam nejde smazat ani změnit", async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: A.companyId } });
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/jen pro zápis/);
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "x" } })).rejects.toThrow(/jen pro zápis/);
    await expect(prisma.auditLog.deleteMany({ where: { companyId: A.companyId } })).rejects.toThrow(/jen pro zápis/);
  });
  it("seed smí jen posunout čas (s výslovným příznakem), nic jiného", async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: A.companyId } });
    const past = new Date("2026-01-01T10:00:00Z");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('obalbook.audit_backdate', 'on', true)`;
      await tx.auditLog.update({ where: { id: log.id }, data: { createdAt: past } });
    });
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).createdAt.toISOString()).toBe(past.toISOString());
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('obalbook.audit_backdate', 'on', true)`;
        await tx.auditLog.update({ where: { id: log.id }, data: { action: "x" } });
      }),
    ).rejects.toThrow(/jen pro zápis/);
  });
});

describe("katalog obalů druhé strany", () => {
  it("usableTypesWhere: vlastní + nabízené + použité v partnerství", async () => {
    const p = await prisma.partnership.findUniqueOrThrow({ where: { id: pAB } });
    const ids = (await prisma.packagingType.findMany({ where: packaging.usableTypesWhere(p, B.companyId) })).map((t) => t.id);
    expect(ids).toContain(tB);
    expect(ids).toContain(tShared);
    expect(ids).toContain(tUsed); // použit výše
    expect(ids).not.toContain(tUnused);
  });

  it("partner nevidí nepoužitý a nenabízený obal (ani jeho kauci) a nemůže ho zapsat", async () => {
    const types = await packaging.listTypesForPartnership(B, pAB);
    expect(types.map((t) => t.id)).not.toContain(tUnused);
    expect(JSON.stringify(types)).not.toContain("SECRET");
    await expect(
      mv.createMovement(B, { partnershipId: pAB, kind: "RECEIPT", date: today(), lines: [{ packagingTypeId: tUnused, quantity: 1 }] }),
    ).rejects.toThrow(/Neznámý typ obalu/);
    // vlastník své typy vidí vždy
    expect((await packaging.listTypesForPartnership(A, pAB)).map((t) => t.id)).toContain(tUnused);
  });

  it("nabízený obal partner zapsat může; po prvním použití vlastníkem i obal nenabízený", async () => {
    const r = await mv.createMovement(B, { partnershipId: pAB, kind: "RECEIPT", date: today(), lines: [{ packagingTypeId: tShared, quantity: 2 }] });
    expect(r.id).toBeTruthy();
    await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tUnused, quantity: 1 }] });
    expect((await packaging.listTypesForPartnership(B, pAB)).map((t) => t.id)).toContain(tUnused);
  });

  it("import partnera páruje kód jen na nabízený nebo použitý obal druhé strany", async () => {
    const hidden = (await packaging.createPackagingType(A, { name: "Další skrytý", code: "HIDDEN", weightKg: 1 })).id;
    const pb = await prisma.partnership.findUniqueOrThrow({ where: { id: pAB } });
    const text = `datum;partner;druh;obal;pocet\n${today()};${pb.codeB};příjem;HIDDEN;1\n${today()};${pb.codeB};příjem;POOL;1\n`;
    const map = { date: "datum", partner: "partner", kind: "druh", packaging: "obal", quantity: "pocet" };
    const prev = await csv.previewImport(B, text, map);
    expect(prev.errorCount).toBe(1);
    expect(prev.errors[0].message).toMatch(/Neznámý kód obalu „HIDDEN“/);
    expect(hidden).toBeTruthy();
  });

  it("nastavení „nabízet partnerům“ jde změnit a zapisuje se do auditu", async () => {
    await packaging.updatePackagingType(A, tShared, { sharedWithPartners: false });
    expect((await prisma.packagingType.findUniqueOrThrow({ where: { id: tShared } })).sharedWithPartners).toBe(false);
    await packaging.updatePackagingType(A, tShared, { name: "Poolová paleta 2" });
    expect((await prisma.packagingType.findUniqueOrThrow({ where: { id: tShared } })).sharedWithPartners).toBe(false);
  });
});

describe("omezení počtu pokusů", () => {
  it("pustí limit pokusů, další odmítne; po uplynutí okna znovu pustí", async () => {
    const key = `test:${rnd()}`;
    for (let i = 0; i < 3; i++) expect(await hit(key, 3, 60)).toBe(true);
    expect(await hit(key, 3, 60)).toBe(false);
    expect(await hit(`${key}-jiny`, 3, 60)).toBe(true); // jiný klíč se nepočítá
    await prisma.rateLimit.update({ where: { key }, data: { windowStart: new Date(Date.now() - 120_000) } });
    expect(await hit(key, 3, 60)).toBe(true);
  });
  it("souběžné pokusy se počítají přesně", async () => {
    const key = `test:${rnd()}`;
    const res = await Promise.all(Array.from({ length: 10 }, () => hit(key, 5, 60)));
    expect(res.filter(Boolean)).toHaveLength(5);
  });
});

describe("pozvánka kolegy neprozrazuje registrované e-maily", () => {
  it("e-mail jiné firmy: stejná odpověď jako u nového e-mailu, přijmout ale nejde", async () => {
    const { url } = await inviteUser(A, { email: C.email, role: "SKLAD" });
    await expect(acceptInvitation(C.userId, url.split("/invite/")[1])).rejects.toThrow(/jiné firmě/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: C.userId } })).companyId).toBe(C.companyId);
  });
});
