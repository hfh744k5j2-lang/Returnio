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
  const partnerships = await prisma.partnership.findMany({ where: partnershipScope(ctx.companyId), select: { id: true } });
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      { OR: [{ companyId: ctx.companyId }, { partnershipId: { in: partnerships.map((p) => p.id) } }] },
      f.entityType ? { entityType: f.entityType } : {},
      f.entityId ? { entityId: f.entityId } : {},
    ],
  };
  const pageSize = Math.min(Math.max(f.pageSize ?? 100, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { email: true, companyId: true } } },
      orderBy: { createdAt: "desc" },
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
      // uživatele z partnerské firmy ukazujeme jen e-mailem; neregistrovaného partnera jeho jménem
      actor: a.user?.email ?? a.actorLabel ?? "systém",
      ownCompany: a.user?.companyId === ctx.companyId,
    })),
  };
}
