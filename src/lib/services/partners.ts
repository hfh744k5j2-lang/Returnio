import { z } from "zod";
import type { Company, Partnership, Prisma, Side } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { appUrl, hashToken, newToken } from "../tokens";
import { sendEmail } from "../email";
import { parse } from "./validate";

type PartnershipWithCompanies = Partnership & { companyA: Company; companyB: Company | null };

export type PartnerView = {
  id: string;
  side: Side;
  name: string;
  email: string | null;
  code: string;
  status: Partnership["status"];
  registered: boolean;
  partnerCompanyId: string | null;
  createdAt: Date;
};

/** Filtr: partnerství, kde je firma z kontextu jednou ze stran. */
export function partnershipScope(companyId: string): Prisma.PartnershipWhereInput {
  return { OR: [{ companyAId: companyId }, { companyBId: companyId }] };
}

export function sideOf(p: { companyAId: string; companyBId: string | null }, companyId: string): Side {
  if (p.companyAId === companyId) return "A";
  if (p.companyBId === companyId) return "B";
  throw notFound("Partner");
}

export const otherSide = (s: Side): Side => (s === "A" ? "B" : "A");

export function toView(p: PartnershipWithCompanies, companyId: string): PartnerView {
  const side = sideOf(p, companyId);
  if (side === "A") {
    return {
      id: p.id,
      side,
      name: p.companyB?.name ?? p.invitedName,
      email: p.invitedEmail,
      code: p.code,
      status: p.status,
      registered: Boolean(p.companyBId),
      partnerCompanyId: p.companyBId,
      createdAt: p.createdAt,
    };
  }
  return {
    id: p.id,
    side,
    name: p.companyA.name,
    email: null,
    code: p.codeB ?? suggestCode(p.companyA.name), // nikdy interní kód strany A
    status: p.status,
    registered: true,
    partnerCompanyId: p.companyAId,
    createdAt: p.createdAt,
  };
}

export async function listPartners(ctx: Ctx): Promise<PartnerView[]> {
  const rows = await prisma.partnership.findMany({
    where: partnershipScope(ctx.companyId),
    include: { companyA: true, companyB: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((p) => toView(p, ctx.companyId)).sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

/** Načte partnerství jen pokud je firma z kontextu jeho stranou – jinak 404 (neprozrazuje existenci). */
export async function getPartnershipRaw(ctx: Ctx, id: string): Promise<PartnershipWithCompanies> {
  if (typeof id !== "string" || !id) throw notFound("Partner");
  const p = await prisma.partnership.findFirst({
    where: { id, ...partnershipScope(ctx.companyId) },
    include: { companyA: true, companyB: true },
  });
  if (!p) throw notFound("Partner");
  return p;
}

export async function getPartner(ctx: Ctx, id: string): Promise<PartnerView> {
  return toView(await getPartnershipRaw(ctx, id), ctx.companyId);
}

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, "Kód smí obsahovat jen písmena A–Z, číslice, - a _ (max. 20 znaků).");

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Zadejte název partnera.").max(200),
  email: z.string().trim().toLowerCase().email("Zadejte platný e-mail partnera."),
  code: codeSchema.optional(),
});

export function suggestCode(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return base || "PARTNER";
}

async function uniqueCode(companyId: string, wanted: string): Promise<string> {
  let code = wanted;
  for (let i = 2; i < 1000; i++) {
    const clashA = await prisma.partnership.findFirst({ where: { companyAId: companyId, code } });
    const clashB = await prisma.partnership.findFirst({ where: { companyBId: companyId, codeB: code } });
    if (!clashA && !clashB) return code;
    code = `${wanted.slice(0, 17)}${i}`;
  }
  throw conflict("Nepodařilo se vytvořit unikátní kód partnera.");
}

/** Pozvání partnera e-mailem. Partner se může zdarma zaregistrovat, nebo potvrzovat přes jednorázové odkazy. */
export async function invitePartner(ctx: Ctx, input: unknown) {
  assertCan(ctx.role, "partners.manage");
  const data = parse(inviteSchema, input);
  const me = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });

  const ownUser = await prisma.user.findFirst({ where: { email: data.email, companyId: ctx.companyId } });
  if (ownUser) throw invalid("Tento e-mail patří kolegovi z vaší firmy.");
  const dup = await prisma.partnership.findFirst({
    where: { companyAId: ctx.companyId, invitedEmail: data.email },
  });
  if (dup) throw conflict("Partnera s tímto e-mailem už máte.");

  if (data.code) {
    const clash = await prisma.partnership.findFirst({
      where: { OR: [{ companyAId: ctx.companyId, code: data.code }, { companyBId: ctx.companyId, codeB: data.code }] },
    });
    if (clash) throw conflict("Kód partnera už používáte.");
  }
  const code = data.code ?? (await uniqueCode(ctx.companyId, suggestCode(data.name)));
  const { token, hash } = newToken();

  const p = await prisma.$transaction(async (tx) => {
    const p = await tx.partnership.create({
      data: {
        companyAId: ctx.companyId,
        invitedName: data.name,
        invitedEmail: data.email,
        code,
        inviteTokenHash: hash,
        inviteExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId, // interní záznam firmy A – bez partnershipId, partner ho nevidí
      action: "partner.invited",
      entityType: "Partnership",
      entityId: p.id,
      data: { name: data.name, email: data.email, code },
    });
    return p;
  });

  const url = appUrl(`/partner-invite/${token}`);
  await sendEmail({
    to: data.email,
    subject: `${me.name} vás zve ke sdílené evidenci obalů (ObalBook)`,
    text:
      `Dobrý den,\n\nfirma ${me.name} s vámi chce sdílet evidenci vratných obalů v ObalBook.\n` +
      `Registrace je pro partnery zdarma: ${url}\n\n` +
      `Pokud se registrovat nechcete, budou vám chodit e-maily s jednorázovými odkazy na potvrzení jednotlivých pohybů.\n\n` +
      `---\n${me.name} invites you to share returnable packaging records in ObalBook. Free registration: ${url}`,
  });
  return { partnership: p, url };
}

export async function findPartnerInvite(token: string) {
  const p = await prisma.partnership.findUnique({
    where: { inviteTokenHash: hashToken(token) },
    include: { companyA: true },
  });
  if (!p || p.status !== "PENDING" || (p.inviteExpiresAt && p.inviteExpiresAt < new Date())) return null;
  return p;
}

/** Přijetí pozvánky partnera: firma přihlášeného uživatele se stane stranou B. */
export async function acceptPartnerInvite(ctx: Ctx, token: string) {
  assertCan(ctx.role, "partners.manage");
  const p = await findPartnerInvite(token);
  if (!p) throw invalid("Pozvánka partnera je neplatná nebo už byla použita.");
  if (p.companyAId === ctx.companyId) throw invalid("Nemůžete přijmout pozvánku od vlastní firmy.");
  // Pozvánku smí přijmout jen uživatel s e-mailem, na který byla poslána (přeposlaný odkaz nestačí).
  if (ctx.email.toLowerCase() !== p.invitedEmail.toLowerCase())
    throw forbidden(`Pozvánka je určena pro ${p.invitedEmail}. Přihlaste se tímto e-mailem.`);
  const existing = await prisma.partnership.findFirst({
    where: {
      OR: [
        { companyAId: p.companyAId, companyBId: ctx.companyId },
        { companyAId: ctx.companyId, companyBId: p.companyAId },
      ],
    },
  });
  if (existing) throw conflict("S touto firmou už partnerství máte.");
  // Nevzniká druhé partnerství se stejnou firmou: máme-li k pozývající firmě nevyřízenou pozvánku na její e-mail,
  // musí pozývající firma přijmout tu (jinak by se historie rozdělila).
  const otherEmails = (await prisma.user.findMany({ where: { companyId: p.companyAId }, select: { email: true } })).map((u) => u.email);
  const mirror = await prisma.partnership.findFirst({
    where: { companyAId: ctx.companyId, companyBId: null, invitedEmail: { in: otherEmails } },
  });
  if (mirror)
    throw conflict("Této firmě jste už poslali pozvánku. Ať přijme tu původní – jinak by se historie pohybů rozdělila.");
  const codeB = await uniqueCode(ctx.companyId, suggestCode(p.companyA.name));
  return prisma.$transaction(async (tx) => {
    // podmíněná změna: pozvánku může přijmout jen jedna firma, i při souběhu
    const res = await tx.partnership.updateMany({
      where: { id: p.id, status: "PENDING", companyBId: null, inviteTokenHash: hashToken(token) },
      data: {
        companyBId: ctx.companyId,
        status: "ACTIVE",
        activatedAt: new Date(),
        inviteTokenHash: null,
        codeB,
      },
    });
    if (res.count !== 1) throw conflict("Pozvánku už mezitím přijal někdo jiný.");
    // Nevyužité jednorázové odkazy přestávají platit – partner teď potvrzuje v aplikaci.
    await tx.partnerLinkToken.updateMany({
      where: { partnershipId: p.id, usedAt: null },
      data: { expiresAt: new Date() },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      partnershipId: p.id,
      action: "partner.accepted",
      entityType: "Partnership",
      entityId: p.id,
    });
    return tx.partnership.findUniqueOrThrow({ where: { id: p.id } });
  });
}

const updateSchema = z.object({
  name: z.string().trim().min(2, "Název musí mít alespoň 2 znaky.").max(200).optional(),
  email: z.string().trim().toLowerCase().email("Zadejte platný e-mail partnera.").optional(),
  code: codeSchema.optional(),
});

/** Úprava vlastního kódu (a u neregistrovaného partnera i názvu). */
export async function updatePartner(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.role, "partners.manage");
  const p = await getPartnershipRaw(ctx, id);
  const side = sideOf(p, ctx.companyId);
  const data = parse(updateSchema, input);
  if (data.code) {
    const clash = await prisma.partnership.findFirst({
      where: {
        id: { not: p.id },
        OR: [{ companyAId: ctx.companyId, code: data.code }, { companyBId: ctx.companyId, codeB: data.code }],
      },
    });
    if (clash) throw conflict("Kód partnera už používáte.");
  }
  const emailChange = side === "A" && !p.companyBId && data.email && data.email !== p.invitedEmail ? data.email : null;
  if (data.email && !emailChange && data.email !== p.invitedEmail && side === "A")
    throw invalid("E-mail lze změnit jen u partnera, který se zatím nezaregistroval.");
  const change: Prisma.PartnershipUpdateInput =
    side === "A"
      ? {
          ...(data.code ? { code: data.code } : {}),
          ...(data.name && !p.companyBId ? { invitedName: data.name } : {}),
          ...(emailChange ? { invitedEmail: emailChange } : {}),
        }
      : { ...(data.code ? { codeB: data.code } : {}) };
  await prisma.$transaction(async (tx) => {
    await tx.partnership.update({ where: { id: p.id }, data: change });
    if (emailChange) {
      // starý e-mail už nesmí nic potvrzovat ani přijmout pozvánku
      await tx.partnerLinkToken.updateMany({ where: { partnershipId: p.id, usedAt: null }, data: { expiresAt: new Date() } });
      await tx.partnership.update({ where: { id: p.id }, data: { inviteTokenHash: null } });
    }
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId, // interní (vlastní kód/název partnera)
      action: "partner.updated",
      entityType: "Partnership",
      entityId: p.id,
      data: { side, ...data, ...(emailChange ? { previousEmail: p.invitedEmail } : {}) },
    });
  });
  if (emailChange) {
    await resendPartnerInvite(ctx, p.id);
    // čekající pohyby dostanou nové odkazy na nový e-mail
    const { resendAllPartnerLinks } = await import("./movements");
    await resendAllPartnerLinks(p.id);
  }
}

/** Opětovné odeslání pozvánky (nový odkaz, starý přestane platit). */
export async function resendPartnerInvite(ctx: Ctx, id: string) {
  assertCan(ctx.role, "partners.manage");
  const p = await getPartnershipRaw(ctx, id);
  if (sideOf(p, ctx.companyId) !== "A" || p.status !== "PENDING") throw invalid("Pozvánku nelze znovu odeslat.");
  const { token, hash } = newToken();
  await prisma.$transaction(async (tx) => {
    await tx.partnership.update({
      where: { id: p.id },
      data: { inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "partner.invite_resent",
      entityType: "Partnership",
      entityId: p.id,
    });
  });
  const url = appUrl(`/partner-invite/${token}`);
  await sendEmail({
    to: p.invitedEmail,
    subject: `${p.companyA.name} – pozvánka do ObalBook`,
    text: `Firma ${p.companyA.name} vás zve ke sdílené evidenci obalů. Registrace zdarma: ${url}`,
  });
  return { url };
}

/** E-maily, kam posílat upozornění pro danou stranu partnerství. */
export async function notifyEmailsForSide(p: Partnership, side: Side): Promise<string[]> {
  const companyId = side === "A" ? p.companyAId : p.companyBId;
  if (!companyId) return [p.invitedEmail];
  const users = await prisma.user.findMany({
    where: { companyId, role: { in: ["ADMIN", "LOGISTIK"] } },
    select: { email: true },
  });
  return users.map((u) => u.email);
}
