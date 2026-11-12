import { randomBytes } from "crypto";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";

export const rnd = () => randomBytes(4).toString("hex");

/** Firma s uživatelem dané role – vrací kontext, jak ho dostávají služby. */
export async function makeCompany(name = `Firma ${rnd()}`, role: Role = "ADMIN"): Promise<Ctx> {
  const company = await prisma.company.create({ data: { name } });
  const user = await prisma.user.create({ data: { email: `u-${rnd()}@example.com`, companyId: company.id, role } });
  return { userId: user.id, companyId: company.id, role, email: user.email, name: null };
}

export async function addMember(ctx: Ctx, role: Role): Promise<Ctx> {
  const user = await prisma.user.create({ data: { email: `u-${rnd()}@example.com`, companyId: ctx.companyId, role } });
  return { userId: user.id, companyId: ctx.companyId, role, email: user.email, name: null };
}
