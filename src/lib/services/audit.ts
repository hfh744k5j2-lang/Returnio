import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { partnershipScope } from "./partners";

/**
 * Auditní stopa viditelná pro firmu: vlastní záznamy + záznamy k partnerstvím, kde je firma stranou.
 */
export async function listAudit(
  ctx: Ctx,
  f: { entityType?: string; entityId?: string; page?: number; pageSize?: number } = {},
) {
  assertCan(ctx.role, "audit.view");
  return queryAudit(ctx, f);
}

/** Historie jednoho pohybu – vidí ji každý, kdo vidí pohyb (i skladník). */
export async function movementHistory(ctx: Ctx, movementId: string) {
  return (await queryAudit(ctx, { entityType: "Movement", entityId: movementId, pageSize: 200 })).items;
}

async function queryAudit(ctx: Ctx, f: { entityType?: string; entityId?: string; page?: number; pageSize?: number }) {
  const partnerships = await prisma.partnership.findMany({ where: partnershipScope(ctx.companyId), select: { id: true, companyAId: true, companyBId: true } });
  const parties = new Map(partnerships.map((p) => [p.id, [p.companyAId, p.companyBId]]));
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      { OR: [{ companyId: ctx.companyId }, { partnershipId: { in: partnerships.map((p) => p.id) } }] },
      f.entityType ? { entityType: f.entityType } : {},
      f.entityId ? { entityId: f.entityId } : {},
    ],
  };
  const pageSize = Math.min(Math.max(f.pageSize ?? 100, 1), 500);
  const page = Math.min(Math.max(f.page ?? 1, 1), 10_000);
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { email: true } },
        actorCompany: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: items.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      data: a.data,
      actor: actorLabel(a, ctx.companyId, a.partnershipId ? (parties.get(a.partnershipId) ?? []) : []),
      ownCompany: Boolean(a.userId) && a.actorCompanyId === ctx.companyId,
    })),
  };
}

/**
 * Kdo akci provedl – podle snímku firmy v okamžiku zápisu (ne podle aktuální firmy uživatele).
 * Vlastní kolegy ukazujeme e-mailem, zaměstnance partnera jen názvem jeho firmy, neregistrovaného
 * partnera jménem z odkazu. Název firmy, která není stranou partnerství, se nikdy neukáže.
 */
function actorLabel(
  a: {
    userId: string | null;
    actorLabel: string | null;
    actorCompanyId: string | null;
    user: { email: string } | null;
    actorCompany: { id: string; name: string } | null;
  },
  companyId: string,
  partySides: (string | null)[],
): string {
  if (!a.userId) return a.actorLabel ?? "systém";
  if (a.actorCompanyId === companyId) return a.user?.email ?? "kolega";
  if (a.actorCompany && partySides.includes(a.actorCompany.id)) return a.actorCompany.name;
  return "partner";
}
