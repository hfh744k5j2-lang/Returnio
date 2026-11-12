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
  await tx.auditLog.create({
    data: {
      userId: entry.actor.userId ?? null,
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
