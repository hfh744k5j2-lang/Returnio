/**
 * M2 – ODDĚLENÍ DAT. Nejdůležitější test projektu.
 *
 * Scénář: A a B jsou partneři, C a D jsou partneři, A má navíc neregistrovaného partnera U.
 * Firma A nesmí nikdy vidět ani změnit nic z C/D. Firma B nesmí vidět A-ho jiné partnery.
 * Každá exportovaná funkce služeb musí být v tomto souboru pokrytá (viz test „registr“ na konci).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { AppError } from "@/lib/errors";
import * as companies from "@/lib/services/companies";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as movements from "@/lib/services/movements";
import * as balance from "@/lib/services/balance";
import * as audit from "@/lib/services/audit";
import { addMember, makeCompany } from "./fixtures";

let A: Ctx, B: Ctx, C: Ctx, D: Ctx, A_sklad: Ctx;
let pAB: string, pCD: string, pAU: string;
let typeA: string, typeB: string, typeC: string, typeD: string;
let mAB: string, mCD: string, mCDdisputed: string, mAU: string;

async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
}

async function connect(x: Ctx, y: Ctx) {
  const { url } = await partners.invitePartner(x, { name: "Partner", email: `p-${y.companyId}@example.com` });
  await partners.acceptPartnerInvite(y, url.split("/partner-invite/")[1]);
  const p = await prisma.partnership.findFirstOrThrow({ where: { companyAId: x.companyId, companyBId: y.companyId } });
  return p.id;
}

beforeAll(async () => {
  A = await makeCompany("Firma A");
  B = await makeCompany("Firma B");
  C = await makeCompany("Firma C");
  D = await makeCompany("Firma D");
  A_sklad = await addMember(A, "SKLAD");
  pAB = await connect(A, B);
  pCD = await connect(C, D);
  pAU = (await partners.invitePartner(A, { name: "Neregistrovaný U", email: "u-unreg@example.com" })).partnership.id;

  typeA = (await packaging.createPackagingType(A, { name: "EUR paleta A", code: "EUR", weightKg: 25, reusable: true })).id;
  typeB = (await packaging.createPackagingType(B, { name: "Přepravka B", code: "BOX", weightKg: 2, reusable: true })).id;
  typeC = (await packaging.createPackagingType(C, { name: "IBC C", code: "IBC", weightKg: 60, reusable: true })).id;
  typeD = (await packaging.createPackagingType(D, { name: "Box D", code: "BOXD", weightKg: 1, reusable: true })).id;

  const today = new Date().toISOString().slice(0, 10);
  mAB = (await movements.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeA, quantity: 10 }] })).id;
  await movements.confirmMovement(B, mAB);
  mCD = (await movements.createMovement(C, { partnershipId: pCD, kind: "ISSUE", date: today, deliveryNote: "DL-CD-1", lines: [{ packagingTypeId: typeC, quantity: 7 }] })).id;
  mCDdisputed = (await movements.createMovement(C, { partnershipId: pCD, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeC, quantity: 5 }] })).id;
  await movements.disputeMovement(D, mCDdisputed, { reason: "Přišly jen 4", lines: [{ packagingTypeId: typeC, quantity: 4 }] });
  await movements.confirmMovement(D, mCD);
  await movements.createMovement(D, { partnershipId: pCD, kind: "RETURN", direction: "OUT", date: today, lines: [{ packagingTypeId: typeD, quantity: 3 }] });
  mAU = (await movements.createMovement(A, { partnershipId: pAU, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeA, quantity: 2 }] })).id;
});

describe("partneři", () => {
  it("A vidí jen své partnery", async () => {
    const ids = (await partners.listPartners(A)).map((p) => p.id).sort();
    expect(ids).toEqual([pAB, pAU].sort());
  });
  it("B nevidí A-ho ostatní partnery", async () => {
    expect((await partners.listPartners(B)).map((p) => p.id)).toEqual([pAB]);
    await expectNotFound(partners.getPartner(B, pAU));
  });
  it("A nemůže číst ani měnit cizí partnerství", async () => {
    await expectNotFound(partners.getPartner(A, pCD));
    await expectNotFound(partners.getPartnershipRaw(A, pCD));
    await expectNotFound(partners.updatePartner(A, pCD, { code: "HACK" }));
    await expectNotFound(partners.resendPartnerInvite(A, pCD));
    const p = await prisma.partnership.findUniqueOrThrow({ where: { id: pCD } });
    expect(p.code).not.toBe("HACK");
    expect(p.codeB).not.toBe("HACK");
  });
  it("prázdné nebo nesmyslné ID vrací 404", async () => {
    await expectNotFound(partners.getPartner(A, ""));
    await expectNotFound(partners.getPartner(A, "neexistuje"));
  });
  it("e-mailové adresy pro upozornění patří jen dané straně", async () => {
    const p = await prisma.partnership.findUniqueOrThrow({ where: { id: pAB } });
    const emails = await partners.notifyEmailsForSide(p, "B");
    const bUsers = await prisma.user.findMany({ where: { companyId: B.companyId } });
    expect(emails.every((e) => bUsers.some((u) => u.email === e))).toBe(true);
  });
  it("pomocné funkce sideOf/toView odmítnou cizí firmu", async () => {
    const p = await prisma.partnership.findUniqueOrThrow({ where: { id: pCD }, include: { companyA: true, companyB: true } });
    expect(() => partners.sideOf(p, A.companyId)).toThrow(AppError);
    expect(() => partners.toView(p, A.companyId)).toThrow(AppError);
    expect(partners.otherSide("A")).toBe("B");
    expect(partners.partnershipScope(A.companyId)).toEqual({ OR: [{ companyAId: A.companyId }, { companyBId: A.companyId }] });
  });
});

describe("typy obalů", () => {
  it("A vidí jen své typy", async () => {
    const ids = (await packaging.listPackagingTypes(A, { includeInactive: true })).map((t) => t.id);
    expect(ids).toEqual([typeA]);
  });
  it("A nemůže číst ani měnit typ firmy C", async () => {
    await expectNotFound(packaging.getPackagingType(A, typeC));
    await expectNotFound(packaging.updatePackagingType(A, typeC, { name: "Hack", code: "IBC", weightKg: 1, reusable: false }));
    const t = await prisma.packagingType.findUniqueOrThrow({ where: { id: typeC } });
    expect(t.name).toBe("IBC C");
  });
  it("typy pro pohyb s partnerem = jen typy obou stran", async () => {
    const ids = (await packaging.listTypesForPartnership(A, pAB)).map((t) => t.id).sort();
    expect(ids).toEqual([typeA, typeB].sort());
    await expectNotFound(packaging.listTypesForPartnership(A, pCD));
  });
  it("vytvoření typu jde vždy do vlastní firmy", async () => {
    const t = await packaging.createPackagingType(A, { name: "Test", code: "TST", weightKg: 1, reusable: false, companyId: C.companyId });
    expect(t.companyId).toBe(A.companyId);
  });
});

describe("pohyby", () => {
  it("A nevidí pohyby C–D v seznamu ani přes filtry", async () => {
    const all = await movements.listMovements(A, { pageSize: 500 });
    expect(all.items.map((m) => m.id).sort()).toEqual([mAB, mAU].sort());
    expect((await movements.listMovements(A, { partnershipId: pCD })).total).toBe(0);
    const cd = await prisma.movement.findUniqueOrThrow({ where: { id: mCD } });
    expect((await movements.listMovements(A, { q: String(cd.number) })).total).toBe(0);
    expect((await movements.listMovements(A, { q: "DL-CD-1" })).total).toBe(0);
    expect((await movements.listMovements(A, { status: "DISPUTED" })).total).toBe(0);
    expect((await movements.listAllMovements(A)).map((m) => m.id).sort()).toEqual([mAB, mAU].sort());
  });
  it("B nevidí pohyby A s neregistrovaným partnerem", async () => {
    expect((await movements.listMovements(B)).items.map((m) => m.id)).toEqual([mAB]);
    await expectNotFound(movements.getMovement(B, mAU));
  });
  it("A nemůže číst ani měnit pohyby C–D", async () => {
    await expectNotFound(movements.getMovement(A, mCD));
    await expectNotFound(movements.confirmMovement(A, mCDdisputed));
    await expectNotFound(movements.disputeMovement(A, mCD, { reason: "hack", lines: [{ packagingTypeId: typeC, quantity: 0 }] }));
    await expectNotFound(movements.acceptCorrection(A, mCDdisputed));
    await expectNotFound(movements.counterCorrection(A, mCDdisputed, { reason: "hack", lines: [{ packagingTypeId: typeC, quantity: 0 }] }));
    await expectNotFound(movements.cancelMovement(A, mCDdisputed));
    const m = await prisma.movement.findUniqueOrThrow({ where: { id: mCDdisputed } });
    expect(m.status).toBe("DISPUTED");
  });
  it("A nemůže zapsat pohyb do cizího partnerství ani s cizím typem obalu", async () => {
    const before = await prisma.movement.count();
    const today = new Date().toISOString().slice(0, 10);
    await expectNotFound(movements.createMovement(A, { partnershipId: pCD, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeA, quantity: 1 }] }));
    await expect(
      movements.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeC, quantity: 1 }] }),
    ).rejects.toThrow(/Neznámý/);
    await expect(
      movements.createMovement(A_sklad, { partnershipId: pAB, kind: "ISSUE", date: today, lines: [{ packagingTypeId: typeD, quantity: 1 }] }),
    ).rejects.toThrow(/Neznámý/);
    expect(await prisma.movement.count()).toBe(before);
  });
  it("počítadla na přehledu počítají jen vlastní pohyby", async () => {
    const c = await movements.movementCounters(A);
    expect(c.disputesAll).toBe(0);
    expect(c.waitingForPartner).toBe(1); // mAU
    const d = await movements.movementCounters(D);
    expect(d.disputesAll).toBe(1);
  });
  it("jednorázový odkaz platí jen pro svůj pohyb a nelze s ním sáhnout na cizí data", async () => {
    const mail = await prisma.devEmail.findFirstOrThrow({ where: { to: "u-unreg@example.com", text: { contains: "/p/" } }, orderBy: { createdAt: "desc" } });
    const token = mail.text.match(/\/p\/([A-Za-z0-9_-]+)/)![1];
    const found = await movements.findPartnerLink(token);
    expect(found?.movement.id).toBe(mAU);
    // pokus o rozpor s typem obalu firmy C
    await expect(
      movements.actOnPartnerLink(token, "dispute", { name: "Útočník", reason: "hack", lines: [{ packagingTypeId: typeC, quantity: 1 }] }),
    ).rejects.toThrow(/jen obaly, které jsou v pohybu/);
    expect(await movements.findPartnerLink("neplatny-token")).toBeNull();
    expect(await movements.findPartnerLink("")).toBeNull();
  });
  it("sendPartnerLink posílá jen neregistrovanému partnerovi", async () => {
    expect(await movements.sendPartnerLink(mAB)).toBeNull();
  });
  it("pohled na pohyb nejde sestavit pro cizí firmu", async () => {
    const m = await prisma.movement.findUniqueOrThrow({
      where: { id: mCD },
      include: { partnership: { include: { companyA: true, companyB: true } }, lines: { include: { packagingType: { include: { company: true } } } }, corrections: true },
    });
    expect(() => movements.toMovementView(m, A.companyId, "ADMIN")).toThrow(AppError);
    expect(movements.movementScope(A.companyId)).toBeTruthy();
    expect(movements.formatMovementNumber(5)).toBe("P-000005");
  });
});

describe("saldo", () => {
  it("saldo A obsahuje jen partnerství A", async () => {
    const { rows } = await balance.getBalances(A);
    expect(new Set(rows.map((r) => r.partnershipId))).toEqual(new Set([pAB, pAU]));
    expect(rows.find((r) => r.partnershipId === pAB)?.confirmed).toBe(10);
    expect((await balance.getBalances(A, { partnershipId: pCD })).rows).toEqual([]);
  });
  it("B vidí totéž saldo s opačným znaménkem", async () => {
    const { rows } = await balance.getBalances(B);
    expect(rows).toHaveLength(1);
    expect(rows[0].confirmed).toBe(-10);
  });
  it("výpočet ignoruje agregace cizích partnerství", async () => {
    const agg = await balance.loadAggregates([pCD]);
    expect(agg.length).toBeGreaterThan(0);
    expect(balance.computeBalances(agg, new Map([[pAB, "A"]]))).toEqual([]);
    expect(balance.totalAbsByPartner([]).size).toBe(0);
  });
});

describe("auditní stopa", () => {
  it("A nevidí záznamy firem C a D", async () => {
    const { items } = await audit.listAudit(A, { pageSize: 500 });
    const logs = await prisma.auditLog.findMany({ where: { id: { in: items.map((i) => i.id) } } });
    for (const l of logs) {
      const own = l.companyId === A.companyId;
      const shared = l.partnershipId === pAB || l.partnershipId === pAU;
      expect(own || shared).toBe(true);
    }
    expect(logs.some((l) => l.companyId === C.companyId || l.partnershipId === pCD)).toBe(false);
    expect(await audit.movementHistory(A, mCD)).toEqual([]);
    expect((await audit.listAudit(A, { entityId: typeC })).total).toBe(0);
  });
  it("B nevidí interní záznamy A (např. pozvání neregistrovaného partnera)", async () => {
    const { items } = await audit.listAudit(B, { pageSize: 500 });
    expect(items.some((i) => i.entityId === pAU)).toBe(false);
    expect(items.some((i) => i.entityId === typeA)).toBe(false);
  });
  it("skladník auditní stopu nevidí", async () => {
    await expect(audit.listAudit(A_sklad)).rejects.toThrow(/oprávnění/);
  });
});

describe("firmy a uživatelé", () => {
  it("seznam uživatelů a pozvánek je jen vlastní", async () => {
    const users = await companies.listUsers(A);
    const dbUsers = await prisma.user.findMany({ where: { id: { in: users.map((u) => u.id) } } });
    expect(dbUsers.every((u) => u.companyId === A.companyId)).toBe(true);
    await companies.inviteUser(C, { email: "c-colleague@example.com", role: "SKLAD" });
    expect((await companies.listInvitations(A)).some((i) => i.email === "c-colleague@example.com")).toBe(false);
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: "c-colleague@example.com" } });
    await expectNotFound(companies.revokeInvitation(A, inv.id));
    expect((await companies.getCompany(A)).id).toBe(A.companyId);
  });
  it("úprava firmy mění jen vlastní firmu", async () => {
    await companies.updateCompany(A, { name: "Firma A upravená", id: C.companyId });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: C.companyId } })).name).toBe("Firma C");
  });
});

/**
 * Registr: každá exportovaná funkce služeb musí být v tomto souboru otestovaná, nebo výslovně vyjmutá.
 * Když někdo přidá novou funkci do služby, test selže a připomene doplnit test oddělení dat.
 */
describe("registr pokrytí služeb", () => {
  const EXEMPT = new Set([
    // nepracují s daty konkrétní firmy (registrace / přijetí pozvánky přes token, pomocné funkce)
    "createCompanyForUser",
    "findInvitation",
    "acceptInvitation",
    "changeUserRole", // cizí uživatel → 404, viz companies.test.ts
    "removeUser", // viz companies.test.ts
    "inviteUser",
    "findPartnerInvite",
    "suggestCode",
    "actOnPartnerLink",
  ]);
  it("všechny funkce jsou pokryté", async () => {
    const src = (await import("fs")).readFileSync(__filename, "utf8");
    const modules = { companies, partners, packaging, movements, balance, audit };
    const missing: string[] = [];
    for (const [modName, mod] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function" || EXEMPT.has(name)) continue;
        if (!src.includes(`${modName}.${name}(`)) missing.push(`${modName}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
