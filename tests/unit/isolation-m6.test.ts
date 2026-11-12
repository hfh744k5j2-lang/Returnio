/**
 * M2 pokračování – oddělení dat u funkcí z M5/M6: export CSV, import, výkaz PPWR, upozornění, znovuposlání odkazu.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { AppError } from "@/lib/errors";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as movements from "@/lib/services/movements";
import * as csv from "@/lib/services/csv";
import * as reports from "@/lib/services/reports";
import * as notifications from "@/lib/services/notifications";
import { makeCompany } from "./fixtures";

let A: Ctx, B: Ctx, C: Ctx, D: Ctx;
let pAB: string, pCD: string, pCU: string, tA: string, tC: string, mCD: string, mCU: string;
const today = () => new Date().toISOString().slice(0, 10);

async function link(x: Ctx, y: Ctx) {
  const { url, partnership } = await partners.invitePartner(x, { name: `Partner ${y.companyId.slice(-4)}`, email: y.email });
  await partners.acceptPartnerInvite(y, url.split("/partner-invite/")[1]);
  return partnership.id;
}

beforeAll(async () => {
  A = await makeCompany("M6 A");
  B = await makeCompany("M6 B");
  C = await makeCompany("M6 C – tajná");
  D = await makeCompany("M6 D – tajná");
  pAB = await link(A, B);
  pCD = await link(C, D);
  pCU = (await partners.invitePartner(C, { name: "C-U", email: "m6-cu@example.com" })).partnership.id;
  tA = (await packaging.createPackagingType(A, { name: "Paleta A", code: "EUR", weightKg: 25 })).id;
  tC = (await packaging.createPackagingType(C, { name: "Paleta C", code: "EUR", weightKg: 25 })).id;
  const mAB = await movements.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 5 }] });
  await movements.confirmMovement(B, mAB.id);
  mCD = (await movements.createMovement(C, { partnershipId: pCD, kind: "ISSUE", date: today(), deliveryNote: "DL-TAJNE", lines: [{ packagingTypeId: tC, quantity: 777 }] })).id;
  await movements.confirmMovement(D, mCD);
  mCU = (await movements.createMovement(C, { partnershipId: pCU, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tC, quantity: 1 }] })).id;
});

describe("export a výkaz", () => {
  it("CSV exporty A neobsahují data C/D", async () => {
    const all = (await csv.exportMovementsCsv(A)) + (await csv.exportBalancesCsv(A)) + (await csv.exportPpwrCsv(A, new Date("2000-01-01"), new Date()));
    expect(all).not.toContain("DL-TAJNE");
    expect(all).not.toContain("777");
    expect(all).not.toContain("tajná");
    expect(await csv.exportMovementsCsv(A, { partnershipId: pCD })).not.toContain("DL-TAJNE");
    expect(await csv.exportBalancesCsv(A, { partnershipId: pCD })).not.toContain("777");
  });
  it("výkaz PPWR A počítá jen výdeje A", async () => {
    const r = await reports.ppwrReport(A, new Date("2000-01-01"), new Date(Date.now() + 86400000));
    expect(r.totalPieces).toBe(5);
    expect(r.types.map((t) => t.packagingTypeId)).toEqual([tA]);
  });
  it("B ve výkazu nemá výdeje A (B nic nevydala)", async () => {
    const r = await reports.ppwrReport(B, new Date("2000-01-01"), new Date(Date.now() + 86400000));
    expect(r.totalPieces).toBe(0);
  });
});

describe("import", () => {
  it("import nenajde cizího partnera ani cizí obal a nic nezapíše", async () => {
    const pc = await prisma.partnership.findUniqueOrThrow({ where: { id: pCD } });
    const text = `datum;partner;druh;obal;pocet\n${today()};${pc.code};výdej;EUR;3\n${today()};M6 D – tajná;výdej;EUR;3\n`;
    const map = { date: "datum", partner: "partner", kind: "druh", packaging: "obal", quantity: "pocet" };
    const prev = await csv.previewImport(A, text, map);
    expect(prev.errorCount).toBe(2);
    expect(prev.errors.every((e) => /Neznámý partner/.test(e.message))).toBe(true);
    const before = await prisma.movement.count();
    await expect(csv.runImport(A, text, map, "x.csv")).rejects.toThrow(/chyb/);
    expect(await prisma.movement.count()).toBe(before);
  });
  it("kód obalu se v importu A páruje na typ A, ne na stejný kód firmy C", async () => {
    const pab = await prisma.partnership.findUniqueOrThrow({ where: { id: pAB } });
    const text = `datum;partner;druh;obal;pocet\n${today()};${pab.code};výdej;EUR;4\n`;
    const r = await csv.runImport(A, text, { date: "datum", partner: "partner", kind: "druh", packaging: "obal", quantity: "pocet" }, "a.csv");
    expect(r.movements).toBe(1);
    const lines = await prisma.movementLine.findMany({ where: { movement: { importBatchId: r.batchId } } });
    expect(lines.map((l) => l.packagingTypeId)).toEqual([tA]);
  });
  it("pomocné funkce importu", () => {
    expect(csv.guessMapping(["Datum", "Odběratel", "Druh", "Kód obalu", "Počet ks"])).toMatchObject({ date: "Datum", partner: "Odběratel", kind: "Druh", packaging: "Kód obalu", quantity: "Počet ks" });
    expect(csv.parseDate("31.3.2026")?.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(csv.parseDate("2026-02-30")).toBeNull();
    expect(csv.parseCsv("a;b\n1;2\n").headers).toEqual(["a", "b"]);
    expect(csv.csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csv.csvCell("-5")).toBe("-5");
    expect(csv.toCsv(["x"], [["a;b"]])).toContain('"a;b"');
  });
});

describe("upozornění a odkazy", () => {
  it("upozornění na staré pohyby a limit jdou jen firmě, které se týkají", async () => {
    await prisma.company.update({ where: { id: A.companyId }, data: { balanceAlertLimit: 1 } });
    await prisma.movement.update({ where: { id: mCU }, data: { createdAt: new Date(Date.now() - 5 * 86400000) } });
    const mAB2 = await movements.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] });
    await prisma.movement.update({ where: { id: mAB2.id }, data: { createdAt: new Date(Date.now() - 5 * 86400000) } });
    const since = new Date();
    await notifications.runNotifications();
    const sent = await prisma.devEmail.findMany({ where: { createdAt: { gte: since } } });
    const usersOf = async (c: Ctx) => (await prisma.user.findMany({ where: { companyId: c.companyId } })).map((u) => u.email);
    const [aU, bU, cU, dU] = await Promise.all([usersOf(A), usersOf(B), usersOf(C), usersOf(D)]);
    for (const m of sent) {
      if (m.text.includes("DL-TAJNE") || m.text.includes("tajná")) expect([...cU, ...dU, "m6-cu@example.com"]).toContain(m.to);
      if (m.text.includes("M6 A") || m.text.includes("M6 B")) expect([...aU, ...bU]).toContain(m.to);
    }
    expect(sent.some((m) => bU.includes(m.to) && m.subject.includes("čeká"))).toBe(true); // B má potvrdit mAB2
    expect(sent.some((m) => aU.includes(m.to) && m.subject.includes("limit"))).toBe(true);
    expect(sent.some((m) => m.to === "m6-cu@example.com")).toBe(true); // neregistrovaný partner C dostal připomínku
    // podruhé se nic neopakuje
    const again = new Date();
    await notifications.runNotifications();
    expect(await prisma.devEmail.count({ where: { createdAt: { gte: again } } })).toBe(0);
  });

  it("A nemůže znovu poslat odkaz k pohybu C", async () => {
    await expect(movements.resendPartnerLink(A, mCU)).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
    await movements.resendPartnerLink(C, mCU);
    expect(await movements.resendAllPartnerLinks(pCU)).toBe(1);
  });
});
