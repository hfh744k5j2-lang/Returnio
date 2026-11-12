import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as partners from "@/lib/services/partners";
import * as packaging from "@/lib/services/packaging";
import * as mv from "@/lib/services/movements";
import { getBalances } from "@/lib/services/balance";
import { makeCompany } from "./fixtures";

const today = () => new Date().toISOString().slice(0, 10);

describe("partneři – opravy e-mailu a dvojí partnerství", () => {
  it("změna e-mailu neregistrovaného partnera zneplatní staré odkazy a pošle novou pozvánku", async () => {
    const A = await makeCompany();
    const t = await packaging.createPackagingType(A, { name: "Paleta", code: "PAL", weightKg: 20 });
    const { partnership, url } = await partners.invitePartner(A, { name: "Překlep", email: "preklep@exmaple.com" });
    await mv.createMovement(A, { partnershipId: partnership.id, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: t.id, quantity: 1 }] });
    const oldMail = await prisma.devEmail.findFirstOrThrow({ where: { to: "preklep@exmaple.com", text: { contains: "/p/" } } });
    const oldLink = oldMail.text.match(/\/p\/([A-Za-z0-9_-]+)/)![1];
    await partners.updatePartner(A, partnership.id, { email: "spravne@example.com" });
    expect(await mv.findPartnerLink(oldLink)).toBeNull();
    expect(await partners.findPartnerInvite(url.split("/partner-invite/")[1])).toBeNull();
    const newInvite = await prisma.devEmail.findFirst({ where: { to: "spravne@example.com", text: { contains: "/partner-invite/" } } });
    expect(newInvite).not.toBeNull();
  });

  it("e-mail registrovaného partnera změnit nejde", async () => {
    const A = await makeCompany();
    const B = await makeCompany();
    const { url, partnership } = await partners.invitePartner(A, { name: "Firma B", email: B.email });
    await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
    await expect(partners.updatePartner(A, partnership.id, { email: "jiny@example.com" })).rejects.toThrow(/nezaregistroval/);
  });

  it("nevznikne druhé partnerství se stejnou firmou (zrcadlová pozvánka)", async () => {
    const A = await makeCompany();
    const U = await makeCompany();
    await partners.invitePartner(A, { name: "Firma U", email: U.email }); // A pozve U, U zatím nepřijal
    const { url } = await partners.invitePartner(U, { name: "Firma A", email: A.email }); // U pozve A
    await expect(partners.acceptPartnerInvite(A, url.split("/partner-invite/")[1])).rejects.toThrow(/původní/);
  });
});

describe("typy obalů a saldo", () => {
  it("nevratné obaly nemají saldo", async () => {
    const A = await makeCompany();
    const B = await makeCompany();
    const { url, partnership } = await partners.invitePartner(A, { name: "Firma B", email: B.email });
    await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
    const krt = await packaging.createPackagingType(A, { name: "Karton", code: "KRT", weightKg: 0.4, reusable: false });
    const pal = await packaging.createPackagingType(A, { name: "Paleta", code: "PAL", weightKg: 20 });
    const m = await mv.createMovement(A, {
      partnershipId: partnership.id,
      kind: "ISSUE",
      date: today(),
      lines: [{ packagingTypeId: krt.id, quantity: 500 }, { packagingTypeId: pal.id, quantity: 10 }],
    });
    await mv.confirmMovement(B, m.id);
    const { rows } = await getBalances(A);
    expect(rows.map((r) => r.typeCode)).toEqual(["PAL"]);
    expect(rows[0].confirmed).toBe(10);
  });

  it("deaktivovaný typ jde dál vracet; nabízí se jen pokud už byl v partnerství použit", async () => {
    const A = await makeCompany();
    const B = await makeCompany();
    const { url, partnership } = await partners.invitePartner(A, { name: "Firma B", email: B.email });
    await partners.acceptPartnerInvite(B, url.split("/partner-invite/")[1]);
    const old = await packaging.createPackagingType(A, { name: "Stará", code: "OLD", weightKg: 5 });
    const unused = await packaging.createPackagingType(A, { name: "Nepoužitá", code: "UNU", weightKg: 5 });
    await mv.createMovement(A, { partnershipId: partnership.id, kind: "ISSUE", date: today(), lines: [{ packagingTypeId: old.id, quantity: 5 }] });
    await packaging.updatePackagingType(A, old.id, { active: false });
    await packaging.updatePackagingType(A, unused.id, { active: false });
    const offered = (await packaging.listTypesForPartnership(B, partnership.id)).map((t) => t.code);
    expect(offered).toContain("OLD");
    expect(offered).not.toContain("UNU");
    await mv.createMovement(B, { partnershipId: partnership.id, kind: "RETURN", direction: "OUT", date: today(), lines: [{ packagingTypeId: old.id, quantity: 5 }] });
  });

  it("kauci a materiál jde smazat; nezadaná pole zůstávají; hmotnost musí být > 0; výchozí je vratný", async () => {
    const A = await makeCompany();
    const t = await packaging.createPackagingType(A, { name: "Box", code: "BOX", weightKg: 2, deposit: 50, material: "plast" });
    expect(t.reusable).toBe(true);
    await packaging.updatePackagingType(A, t.id, { deposit: null, material: null });
    const after = await packaging.getPackagingType(A, t.id);
    expect(after.deposit).toBeNull();
    expect(after.material).toBeNull();
    expect(after.name).toBe("Box");
    expect(after.reusable).toBe(true);
    await expect(packaging.createPackagingType(A, { name: "Nula", code: "ZERO", weightKg: 0 })).rejects.toThrow(/větší než 0/);
  });
});
