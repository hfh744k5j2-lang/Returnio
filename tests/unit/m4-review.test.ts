import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as mv from "@/lib/services/movements";
import { parseScanned } from "@/lib/scan";
import { todayLocal } from "@/lib/format";
import { addMember, makeCompany } from "./fixtures";

let A: Ctx, B: Ctx, Bsklad: Ctx, pAB: string, tA: string, tA2: string;
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  A = await makeCompany("R4 A");
  B = await makeCompany("R4 B");
  Bsklad = await addMember(B, "SKLAD");
  const { url, partnership } = await partners.invitePartner(A, { name: "R4 B", email: B.email });
  await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
  pAB = partnership.id;
  tA = (await packaging.createPackagingType(A, { name: "Paleta", code: "PAL", weightKg: 20 })).id;
  tA2 = (await packaging.createPackagingType(A, { name: "Box", code: "BOX", weightKg: 2 })).id;
});

describe("revize M4", () => {
  it("dvojí odeslání se stejným klíčem vytvoří jen jeden pohyb", async () => {
    const input = { partnershipId: pAB, kind: "ISSUE", date: today(), clientKey: "klic-123", lines: [{ packagingTypeId: tA, quantity: 3 }] };
    const [a, b] = await Promise.all([mv.createMovement(A, input), mv.createMovement(A, input)]);
    const c = await mv.createMovement(A, input);
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect(await prisma.movement.count({ where: { clientKey: "klic-123" } })).toBe(1);
  });

  it("úpravu salda potvrzuje jen kancelář, ne skladník", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB, kind: "CORRECTION", direction: "OUT", date: today(), lines: [{ packagingTypeId: tA, quantity: 200 }] });
    await expect(mv.confirmMovement(Bsklad, m.id)).rejects.toThrow(/oprávnění/);
    expect((await mv.getMovement(Bsklad, m.id)).can.confirm).toBe(false);
    await mv.confirmMovement(B, m.id);
  });

  it("protinávrh přes API s jednou položkou drží aktuální návrh u ostatních", async () => {
    const m = await mv.createMovement(A, {
      partnershipId: pAB, kind: "ISSUE", date: today(),
      lines: [{ packagingTypeId: tA, quantity: 40 }, { packagingTypeId: tA2, quantity: 20 }],
    });
    await mv.disputeMovement(B, m.id, { reason: "Jinak", lines: [{ packagingTypeId: tA, quantity: 37 }, { packagingTypeId: tA2, quantity: 10 }] });
    await mv.counterCorrection(A, m.id, { reason: "Palety 38", lines: [{ packagingTypeId: tA, quantity: 38 }] });
    await mv.acceptCorrection(B, m.id);
    const v = await mv.getMovement(A, m.id);
    expect(v.lines.find((l) => l.packagingTypeId === tA)?.finalQuantity).toBe(38);
    expect(v.lines.find((l) => l.packagingTypeId === tA2)?.finalQuantity).toBe(10);
  });

  it("vyřazený typ nejde vydat, ale jde vrátit; počet true se nepřijme", async () => {
    const old = await packaging.createPackagingType(A, { name: "Stará", code: "OLD2", weightKg: 5 });
    // obal byl partnerovi dřív vydán (jinak by ho partner neviděl – viz katalog obalů druhé strany)
    await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: old.id, quantity: 1 }] });
    await packaging.updatePackagingType(A, old.id, { active: false });
    await expect(mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: old.id, quantity: 1 }] })).rejects.toThrow(/vyřazený/);
    await mv.createMovement(B, { partnershipId: pAB, kind: "RETURN", direction: "OUT", date: today(), lines: [{ packagingTypeId: old.id, quantity: 1 }] });
    await expect(mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: true }] })).rejects.toThrow(/číslo/);
  });

  it("dnešní datum v pražském čase má tvar YYYY-MM-DD", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("QR kódy", () => {
  it("rozpozná odkazy ObalBooku a odmítne cizí obsah", () => {
    expect(parseScanned("https://app.example.com/scan?partner=cmabc1234567890")).toEqual({ partner: "cmabc1234567890", type: undefined });
    expect(parseScanned("http://localhost:3000/scan?type=cmtype123456789")).toEqual({ partner: undefined, type: "cmtype123456789" });
    expect(parseScanned("https://evil.example.com/login?x=1")).toBeNull();
    expect(parseScanned("nějaký text")).toBeNull();
    expect(parseScanned("https://a.cz/scan")).toBeNull();
    expect(parseScanned("https://a.cz/scan?partner=<script>")).toBeNull();
  });
});
