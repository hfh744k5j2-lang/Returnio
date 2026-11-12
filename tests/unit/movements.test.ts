import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as mv from "@/lib/services/movements";
import { getBalances } from "@/lib/services/balance";
import { addMember, makeCompany } from "./fixtures";

let A: Ctx, B: Ctx, Asklad: Ctx, Bsklad: Ctx;
let pAB: string, pAB2: string, tA: string, tB: string;
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  A = await makeCompany("Mv A");
  B = await makeCompany("Mv B");
  Asklad = await addMember(A, "SKLAD");
  Bsklad = await addMember(B, "SKLAD");
  const { url } = await partners.invitePartner(A, { name: "Firma B", email: B.email });
  await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
  pAB = (await prisma.partnership.findFirstOrThrow({ where: { companyAId: A.companyId, companyBId: B.companyId } })).id;
  pAB2 = (await partners.invitePartner(A, { name: "Druhý", email: "mv-second@example.com" })).partnership.id;
  tA = (await packaging.createPackagingType(A, { name: "EUR paleta", code: "EUR", weightKg: 25, reusable: true })).id;
  tB = (await packaging.createPackagingType(B, { name: "Přepravka", code: "BOX", weightKg: 2, reusable: true })).id;
});

describe("pohyby – číslování a snímek", () => {
  it("číslo pohybu běží v rámci partnerství", async () => {
    const m1 = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] });
    const m2 = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] });
    const o1 = await mv.createMovement(A, { partnershipId: pAB2, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] });
    expect(m2.number).toBe(m1.number + 1);
    expect(o1.number).toBe(1);
  });
  it("souběžné zápisy dostanou různá čísla", async () => {
    const all = await Promise.all(
      Array.from({ length: 5 }, () => mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] })),
    );
    expect(new Set(all.map((m) => m.number)).size).toBe(5);
  });
  it("řádek si pamatuje hmotnost a vratnost v okamžiku zápisu", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 3 }] });
    await packaging.updatePackagingType(A, tA, { name: "EUR paleta", code: "EUR", weightKg: 22, reusable: false });
    const line = await prisma.movementLine.findFirstOrThrow({ where: { movementId: m.id } });
    expect(Number(line.weightKg)).toBe(25);
    expect(line.reusable).toBe(true);
    await packaging.updatePackagingType(A, tA, { name: "EUR paleta", code: "EUR", weightKg: 25, reusable: true });
  });
});

describe("pohyby – potvrzení, rozpor, vyřešení, saldo", () => {
  async function balanceFor(ctx: Ctx, typeId: string) {
    const { rows } = await getBalances(ctx, { partnershipId: pAB });
    return rows.find((r) => r.packagingTypeId === typeId) ?? { confirmed: 0, pending: 0 };
  }

  it("výdej → potvrzení zvýší saldo u obou stran zrcadlově", async () => {
    const before = await balanceFor(A, tB);
    const m = await mv.createMovement(Asklad, { partnershipId: pAB, kind: "ISSUE", date: today(), deliveryNote: "DL-1", lines: [{ packagingTypeId: tB, quantity: 20 }] });
    expect((await balanceFor(A, tB)).pending).toBe(before.pending + 20);
    expect((await balanceFor(A, tB)).confirmed).toBe(before.confirmed);
    await expect(mv.confirmMovement(A, m.id)).rejects.toThrow(/Vlastní pohyb/);
    await mv.confirmMovement(Bsklad, m.id);
    expect((await balanceFor(A, tB)).confirmed).toBe(before.confirmed + 20);
    expect((await balanceFor(B, tB)).confirmed).toBe(-(before.confirmed + 20));
    await expect(mv.confirmMovement(Bsklad, m.id)).rejects.toThrow(/navržen/);
  });

  it("rozpor → protinávrh → přijetí; saldo počítá s dohodnutým počtem", async () => {
    const before = await balanceFor(A, tA);
    const m = await mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 30 }] });
    await expect(mv.disputeMovement(B, m.id, { reason: "x", lines: [{ packagingTypeId: tA, quantity: 28 }] })).rejects.toThrow(/důvod/);
    await expect(mv.disputeMovement(B, m.id, { reason: "Stejné", lines: [{ packagingTypeId: tA, quantity: 30 }] })).rejects.toThrow(/stejný/);
    await mv.disputeMovement(Bsklad, m.id, { reason: "Přišlo jen 26 palet", lines: [{ packagingTypeId: tA, quantity: 26 }] });
    expect((await mv.getMovement(A, m.id)).status).toBe("DISPUTED");
    expect((await balanceFor(A, tA)).confirmed).toBe(before.confirmed);
    // skladník A nesmí rozpor řešit, B nesmí přijmout vlastní návrh
    await expect(mv.acceptCorrection(Asklad, m.id)).rejects.toThrow(/oprávnění/);
    await expect(mv.acceptCorrection(B, m.id)).rejects.toThrow(/partner/);
    await mv.counterCorrection(A, m.id, { reason: "Podle nakládky 28", lines: [{ packagingTypeId: tA, quantity: 28 }] });
    await expect(mv.acceptCorrection(A, m.id)).rejects.toThrow(/partner/);
    await mv.acceptCorrection(B, m.id);
    const view = await mv.getMovement(A, m.id);
    expect(view.status).toBe("CONFIRMED");
    expect(view.lines[0].quantity).toBe(30);
    expect(view.lines[0].finalQuantity).toBe(28);
    expect(view.corrections.map((c) => c.status)).toEqual(["SUPERSEDED", "ACCEPTED"]);
    expect((await balanceFor(A, tA)).confirmed).toBe(before.confirmed + 28);
    const log = await prisma.auditLog.findMany({ where: { entityId: m.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["movement.created", "movement.disputed", "movement.counter_proposed", "movement.dispute_resolved"]);
  });

  it("příjem a vrácení snižují saldo; zrušený pohyb se nepočítá", async () => {
    const before = await balanceFor(A, tA);
    const r = await mv.createMovement(B, { partnershipId: pAB, kind: "RETURN", direction: "OUT", date: today(), lines: [{ packagingTypeId: tA, quantity: 5 }] });
    await mv.confirmMovement(A, r.id);
    expect((await balanceFor(A, tA)).confirmed).toBe(before.confirmed - 5);
    const c = await mv.createMovement(A, { partnershipId: pAB, kind: "RECEIPT", date: today(), lines: [{ packagingTypeId: tA, quantity: 3 }] });
    await expect(mv.cancelMovement(B, c.id)).rejects.toThrow(/Zrušit může jen/);
    await mv.cancelMovement(A, c.id);
    expect((await balanceFor(A, tA)).pending).toBe(before.pending);
    expect(await prisma.movement.count({ where: { id: c.id } })).toBe(1); // nic se nemaže
  });

  it("skladník smí jen výdej/příjem/vrácení; směr je povinný u zvláštních druhů", async () => {
    await expect(
      mv.createMovement(Asklad, { partnershipId: pAB, kind: "LOSS", direction: "IN", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] }),
    ).rejects.toThrow(/oprávnění/);
    await expect(mv.createMovement(A, { partnershipId: pAB, kind: "CORRECTION", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] })).rejects.toThrow(/směr/);
    await expect(
      mv.createMovement(A, { partnershipId: pAB, kind: "ISSUE", direction: "IN", date: today(), lines: [{ packagingTypeId: tA, quantity: 1 }] }),
    ).rejects.toThrow(/nelze zvolit směr/);
  });

  it("validace vstupu", async () => {
    const base = { partnershipId: pAB, kind: "ISSUE", date: today() };
    await expect(mv.createMovement(A, { ...base, lines: [] })).rejects.toThrow(/alespoň jeden/);
    await expect(mv.createMovement(A, { ...base, lines: [{ packagingTypeId: tA, quantity: 0 }] })).rejects.toThrow(/alespoň 1/);
    await expect(mv.createMovement(A, { ...base, lines: [{ packagingTypeId: tA, quantity: 1.5 }] })).rejects.toThrow(/celé číslo/);
    await expect(mv.createMovement(A, { ...base, lines: [{ packagingTypeId: tA, quantity: "abc" }] })).rejects.toThrow(/číslo/);
    await expect(
      mv.createMovement(A, { ...base, lines: [{ packagingTypeId: tA, quantity: 1 }, { packagingTypeId: tA, quantity: 2 }] }),
    ).rejects.toThrow(/jen jednou/);
    await expect(mv.createMovement(A, { ...base, date: "2099-01-01", lines: [{ packagingTypeId: tA, quantity: 1 }] })).rejects.toThrow(/budoucnosti/);
    await expect(mv.createMovement(A, { ...base, date: "nesmysl", lines: [{ packagingTypeId: tA, quantity: 1 }] })).rejects.toThrow(/datum/i);
  });
});

describe("jednorázový odkaz pro neregistrovaného partnera", () => {
  it("partner potvrdí přes odkaz; odkaz jde použít jen jednou", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB2, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 4 }] });
    const mail = await prisma.devEmail.findFirstOrThrow({ where: { to: "mv-second@example.com", text: { contains: "/p/" } }, orderBy: { createdAt: "desc" } });
    const token = mail.text.match(/\/p\/([A-Za-z0-9_-]+)/)![1];
    await expect(mv.actOnPartnerLink(token, "confirm", { name: "" })).rejects.toThrow(/jméno/);
    await mv.actOnPartnerLink(token, "confirm", { name: "Jan Novák" });
    const v = await mv.getMovement(A, m.id);
    expect(v.status).toBe("CONFIRMED");
    expect(v.confirmedByLabel).toContain("Jan Novák");
    await expect(mv.actOnPartnerLink(token, "confirm", { name: "Jan Novák" })).rejects.toThrow(/neplatný|použit/);
  });

  it("rozpor přes odkaz → firma navrhne opravu → partner přijme novým odkazem", async () => {
    const m = await mv.createMovement(A, { partnershipId: pAB2, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: tA, quantity: 10 }] });
    const tok = async () => {
      const mail = await prisma.devEmail.findFirstOrThrow({ where: { to: "mv-second@example.com", text: { contains: "/p/" } }, orderBy: { createdAt: "desc" } });
      return mail.text.match(/\/p\/([A-Za-z0-9_-]+)/)![1];
    };
    await mv.actOnPartnerLink(await tok(), "dispute", { name: "Eva", reason: "Jen 8", lines: [{ packagingTypeId: tA, quantity: 8 }] });
    await mv.counterCorrection(A, m.id, { reason: "Dohoda 9", lines: [{ packagingTypeId: tA, quantity: 9 }] });
    await mv.actOnPartnerLink(await tok(), "accept", { name: "Eva" });
    const v = await mv.getMovement(A, m.id);
    expect(v.status).toBe("CONFIRMED");
    expect(v.lines[0].finalQuantity).toBe(9);
  });
});
