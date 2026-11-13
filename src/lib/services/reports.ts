import { prisma } from "../db";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { invalid } from "../errors";
import { computePpwr, type PpwrBalance, type PpwrRawLine } from "../ppwr";
import { listPartners } from "./partners";
import { computeBalances, loadAggregates } from "./balance";

/**
 * Data pro výkaz PPWR firmy z kontextu za období [from, to].
 * Služba jen dodává surová data (všechny potvrzené řádky pohybů firmy a salda ke dvěma datům);
 * veškerá metodika je v `src/lib/ppwr.ts`.
 */
export async function ppwrReport(ctx: Ctx, from: Date, to: Date, extraOneWay?: { pieces: number; kg: number }) {
  assertCan(ctx.role, "reports.view");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalid("Neplatné období.");
  if (from > to) throw invalid("Začátek období musí být před koncem.");
  const partners = await listPartners(ctx);
  const sideMap = new Map(partners.map((p) => [p.id, p.side]));
  const ids = [...sideMap.keys()];

  const raw = await prisma.movementLine.findMany({
    where: { movement: { status: "CONFIRMED", partnershipId: { in: ids }, date: { lte: to } } },
    include: {
      movement: { select: { kind: true, fromSide: true, partnershipId: true, date: true } },
      packagingType: { select: { code: true, name: true, company: { select: { name: true } } } },
    },
    orderBy: { id: "asc" },
  });
  const lines: PpwrRawLine[] = raw.map((l) => ({
    kind: l.movement.kind,
    fromUs: l.movement.fromSide === sideMap.get(l.movement.partnershipId),
    date: l.movement.date,
    packagingTypeId: l.packagingTypeId,
    code: l.packagingType.code,
    name: l.packagingType.name,
    owner: l.packagingType.company.name,
    reusable: l.reusable,
    weightKg: Number(l.weightKg),
    quantity: l.finalQuantity ?? l.quantity,
  }));

  const balancesAt = async (date: Date): Promise<PpwrBalance[]> =>
    computeBalances(await loadAggregates(ids, date), sideMap).map((r) => ({ partnershipId: r.partnershipId, packagingTypeId: r.packagingTypeId, confirmed: r.confirmed }));
  const dayBefore = new Date(from.getTime() - 24 * 3600 * 1000);
  const [balancesAtStart, balancesAtEnd, pendingCount] = await Promise.all([
    balancesAt(dayBefore),
    balancesAt(to),
    prisma.movement.count({
      where: {
        status: { in: ["PROPOSED", "DISPUTED"] },
        kind: "ISSUE",
        date: { gte: from, lte: to },
        OR: partners.map((p) => ({ partnershipId: p.id, fromSide: p.side })),
      },
    }),
  ]);

  const result = computePpwr({ lines, from, to, balancesAtStart, balancesAtEnd, extraOneWay });
  return { ...result, from, to, pendingCount };
}
