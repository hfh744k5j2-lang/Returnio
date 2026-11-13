import type { Prisma } from "@prisma/client";
import type { Tx, prisma } from "./db";

export type Actor = { userId?: string | null; label?: string | null };

/** Zápis do auditní stopy. Záznamy se nikdy nemění ani nemažou. */
export async function audit(
  tx: Tx | typeof prisma,
  entry: {
    actor: Actor;
    companyId?: string | null;
    partnershipId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    data?: Prisma.InputJsonValue;
  },
) {
  // Snímek firmy, za kterou uživatel jedná TEĎ. Při čtení se nesmí odvozovat z jeho aktuální firmy:
  // po přechodu k jiné firmě by partner viděl název cizí firmy a historie by lhala.
  const actorCompanyId = entry.actor.userId
    ? ((await tx.user.findUnique({ where: { id: entry.actor.userId }, select: { companyId: true } }))?.companyId ?? null)
    : null;
  await tx.auditLog.create({
    data: {
      userId: entry.actor.userId ?? null,
      actorCompanyId,
      actorLabel: entry.actor.label ?? null,
      companyId: entry.companyId ?? null,
      partnershipId: entry.partnershipId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data: entry.data,
    },
  });
}
