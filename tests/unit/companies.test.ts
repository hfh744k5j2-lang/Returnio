import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { hashToken } from "@/lib/tokens";
import {
  acceptInvitation,
  changeUserRole,
  createCompanyForUser,
  inviteUser,
  removeUser,
  updateCompany,
} from "@/lib/services/companies";
import { addMember, makeCompany, rnd } from "./fixtures";

describe("oprávnění rolí", () => {
  it("skladník nesmí spravovat partnery, import ani výkaz", () => {
    expect(can("SKLAD", "movements.create")).toBe(true);
    expect(can("SKLAD", "movements.confirm")).toBe(true);
    expect(can("SKLAD", "partners.manage")).toBe(false);
    expect(can("SKLAD", "import.run")).toBe(false);
    expect(can("SKLAD", "reports.view")).toBe(false);
    expect(can("SKLAD", "movements.createSpecial")).toBe(false);
  });
  it("logistik nesmí spravovat uživatele", () => {
    expect(can("LOGISTIK", "users.manage")).toBe(false);
    expect(can("LOGISTIK", "partners.manage")).toBe(true);
    expect(can("ADMIN", "users.manage")).toBe(true);
  });
});

describe("firmy a uživatelé", () => {
  it("registrace firmy udělá z uživatele admina a zapíše audit", async () => {
    const user = await prisma.user.create({ data: { email: `new-${rnd()}@example.com` } });
    const c = await createCompanyForUser(user.id, { name: "Nová firma", country: "SK" });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.companyId).toBe(c.id);
    expect(u.role).toBe("ADMIN");
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "company.created" } })).toBe(1);
    await expect(createCompanyForUser(user.id, { name: "Druhá" })).rejects.toThrow(/už patří/);
  });

  it("validuje název firmy", async () => {
    const user = await prisma.user.create({ data: { email: `v-${rnd()}@example.com` } });
    await expect(createCompanyForUser(user.id, { name: "x" })).rejects.toThrow(/alespoň 2/);
  });

  it("pozvánka funguje jen pro správný e-mail a jen jednou", async () => {
    const admin = await makeCompany();
    const email = `col-${rnd()}@example.com`;
    const { url } = await inviteUser(admin, { email, role: "SKLAD" });
    const token = url.split("/invite/")[1];
    const other = await prisma.user.create({ data: { email: `other-${rnd()}@example.com` } });
    await expect(acceptInvitation(other.id, token)).rejects.toThrow(/jiný e-mail/);
    const col = await prisma.user.create({ data: { email } });
    await acceptInvitation(col.id, token);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: col.id } });
    expect(u.companyId).toBe(admin.companyId);
    expect(u.role).toBe("SKLAD");
    await expect(acceptInvitation(col.id, token)).rejects.toThrow(/neplatná/);
    // token se ukládá jen jako hash
    expect(await prisma.invitation.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.invitation.count({ where: { tokenHash: hashToken(token) } })).toBe(1);
  });

  it("jen admin zve a mění role; firma musí mít admina", async () => {
    const admin = await makeCompany();
    const logistik = await addMember(admin, "LOGISTIK");
    await expect(inviteUser(logistik, { email: `x-${rnd()}@example.com`, role: "ADMIN" })).rejects.toThrow(/oprávnění/);
    await expect(changeUserRole(admin, admin.userId, "SKLAD")).rejects.toThrow(/alespoň jednoho admina/);
    await changeUserRole(admin, logistik.userId, "SKLAD");
    await expect(updateCompany(logistik, { name: "Hack" })).rejects.toThrow(/oprávnění/);
  });

  it("admin nemůže měnit ani odebrat uživatele jiné firmy", async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const bUser = await addMember(b, "SKLAD");
    await expect(changeUserRole(a, bUser.userId, "ADMIN")).rejects.toThrow(/nebyl nalezen/);
    await expect(removeUser(a, bUser.userId)).rejects.toThrow(/nebyl nalezen/);
    const still = await prisma.user.findUniqueOrThrow({ where: { id: bUser.userId } });
    expect(still.companyId).toBe(b.companyId);
  });
});
