import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { appUrl, hashToken, newToken } from "../tokens";
import { sendEmail } from "../email";
import { parse } from "./validate";

export const companySchema = z.object({
  name: z.string().trim().min(2, "Název firmy musí mít alespoň 2 znaky.").max(200),
  regNumber: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  country: z.enum(["CZ", "SK", "PL", "DE", "AT", "HU", "OTHER"]).default("CZ"),
  address: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export const companySettingsSchema = companySchema.extend({
  balanceAlertLimit: z.coerce.number().int().min(1).max(10_000_000).optional().nullable(),
});

/** Registrace firmy: přihlášený uživatel bez firmy se stane jejím adminem. */
export async function createCompanyForUser(userId: string, input: unknown) {
  const data = parse(companySchema, input);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.companyId) throw conflict("Uživatel už patří k firmě.");
    const company = await tx.company.create({ data });
    await tx.user.update({ where: { id: userId }, data: { companyId: company.id, role: "ADMIN" } });
    await audit(tx, {
      actor: { userId },
      companyId: company.id,
      action: "company.created",
      entityType: "Company",
      entityId: company.id,
      data,
    });
    return company;
  });
}

export async function getCompany(ctx: Ctx) {
  return prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
}

export async function updateCompany(ctx: Ctx, input: unknown) {
  assertCan(ctx.role, "company.manage");
  const data = parse(companySettingsSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { ...data, balanceAlertLimit: data.balanceAlertLimit ?? null },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "company.updated",
      entityType: "Company",
      entityId: company.id,
      data: { before: { ...before, createdAt: before.createdAt.toISOString() }, after: data },
    });
    return company;
  });
}

export async function listUsers(ctx: Ctx) {
  return prisma.user.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { email: "asc" },
  });
}

export async function listInvitations(ctx: Ctx) {
  assertCan(ctx.role, "users.manage");
  return prisma.invitation.findMany({
    where: { companyId: ctx.companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Zadejte platný e-mail."),
  role: z.enum(["ADMIN", "LOGISTIK", "SKLAD"]),
});

/** Pozvání kolegy do firmy. Vrací odkaz (v dev režimu se hodí pro ruční test). */
export async function inviteUser(ctx: Ctx, input: unknown) {
  assertCan(ctx.role, "users.manage");
  const data = parse(inviteSchema, input);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing?.companyId === ctx.companyId) throw conflict("Uživatel už je členem firmy.");
  // E-mail registrovaný u jiné firmy: odpověď je stejná jako u nového e-mailu, aby pozvánka
  // neprozrazovala, které e-maily (a tedy firmy) v ObalBooku jsou. Přijmout ji ale nepůjde
  // (acceptInvitation: „Už patříte k jiné firmě“) – adresát se to dozví v e-mailu a na stránce pozvánky.
  const { token, hash } = newToken();
  const company = await getCompany(ctx);
  const inv = await prisma.$transaction(async (tx) => {
    // starší nevyřízené pozvánky na stejný e-mail zneplatníme
    await tx.invitation.updateMany({
      where: { companyId: ctx.companyId, email: data.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const inv = await tx.invitation.create({
      data: {
        companyId: ctx.companyId,
        email: data.email,
        role: data.role,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        createdById: ctx.userId,
      },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "user.invited",
      entityType: "Invitation",
      entityId: inv.id,
      data: { email: data.email, role: data.role },
    });
    return inv;
  });
  const url = appUrl(`/invite/${token}`);
  await sendEmail({
    to: data.email,
    subject: `Pozvánka do ObalBook – ${company.name}`,
    text:
      `Firma ${company.name} vás zve do ObalBook (evidence vratných obalů).\n` +
      `Pozvánku přijmete zde (platí 7 dní):\n${url}\n\n` +
      `Pokud už v ObalBooku máte účet u jiné firmy, pozvánku přijmout nepůjde – použijte jiný pracovní e-mail.\n\n` +
      `${company.name} invites you to ObalBook. Accept here (valid 7 days):\n${url}\n` +
      `If you already have an ObalBook account with another company, use a different work e-mail.`,
  });
  return { invitation: inv, url };
}

export async function revokeInvitation(ctx: Ctx, invitationId: string) {
  assertCan(ctx.role, "users.manage");
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, companyId: ctx.companyId, acceptedAt: null, revokedAt: null },
  });
  if (!inv) throw notFound("Pozvánka");
  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "user.invitation_revoked",
      entityType: "Invitation",
      entityId: inv.id,
    });
  });
}

export async function findInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { company: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Přijetí pozvánky přihlášeným uživatelem. E-mail musí odpovídat pozvánce. */
export async function acceptInvitation(userId: string, token: string) {
  const inv = await findInvitation(token);
  if (!inv) throw invalid("Pozvánka je neplatná nebo vypršela.");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== inv.email.toLowerCase())
      throw forbidden("Pozvánka je určena pro jiný e-mail.");
    if (user.companyId) throw conflict("Už patříte k jiné firmě.");
    await tx.user.update({ where: { id: userId }, data: { companyId: inv.companyId, role: inv.role } });
    const r = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (r.count !== 1) throw invalid("Pozvánka už byla použita.");
    await audit(tx, {
      actor: { userId },
      companyId: inv.companyId,
      action: "user.joined",
      entityType: "User",
      entityId: userId,
      data: { role: inv.role },
    });
    return inv;
  });
}

export async function changeUserRole(ctx: Ctx, userId: string, role: Role) {
  assertCan(ctx.role, "users.manage");
  if (!["ADMIN", "LOGISTIK", "SKLAD"].includes(role)) throw invalid("Neplatná role.");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: ctx.companyId } });
  if (!target) throw notFound("Uživatel");
  if (target.role === "ADMIN" && role !== "ADMIN") await ensureAnotherAdmin(ctx, userId);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "user.role_changed",
      entityType: "User",
      entityId: userId,
      data: { from: target.role, to: role },
    });
  });
}

/** Odebrání uživatele z firmy. Uživatel i jeho historie zůstávají. */
export async function removeUser(ctx: Ctx, userId: string) {
  assertCan(ctx.role, "users.manage");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: ctx.companyId } });
  if (!target) throw notFound("Uživatel");
  if (target.role === "ADMIN") await ensureAnotherAdmin(ctx, userId);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { companyId: null, role: null } });
    await tx.session.deleteMany({ where: { userId } }); // odhlášení (sessions nejsou obchodní data)
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "user.removed",
      entityType: "User",
      entityId: userId,
      data: { email: target.email, role: target.role },
    });
  });
}

async function ensureAnotherAdmin(ctx: Ctx, exceptUserId: string) {
  const admins = await prisma.user.count({
    where: { companyId: ctx.companyId, role: "ADMIN", id: { not: exceptUserId } },
  });
  if (admins === 0) throw invalid("Firma musí mít alespoň jednoho admina.");
}
