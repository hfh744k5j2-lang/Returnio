import { prisma } from "../db";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { invalid } from "../errors";
import { computePpwr, type PpwrPoolPoint } from "../ppwr";
import { listPartners } from "./partners";
import { computeBalances, loadAggregates } from "./balance";

/** Data pro výkaz PPWR firmy z kontextu za období [from, to] (včetně). */
export async function ppwrReport(ctx: Ctx, from: Date, to: Date) {
  assertCan(ctx.role, "reports.view");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalid("Neplatné období.");
  if (from > to) throw invalid("Začátek období musí být před koncem.");
  const partners = await listPartners(ctx);
  const sideMap = new Map(partners.map((p) => [p.id, p.side]));
  const aIds = partners.filter((p) => p.side === "A").map((p) => p.id);
  const bIds = partners.filter((p) => p.side === "B").map((p) => p.id);

  // potvrzené výdeje od nás k partnerům
  const lines = await prisma.movementLine.findMany({
    where: {
      movement: {
        status: "CONFIRMED",
        kind: "ISSUE",
        date: { gte: from, lte: to },
        OR: [
          { partnershipId: { in: aIds }, fromSide: "A" },
          { partnershipId: { in: bIds }, fromSide: "B" },
        ],
      },
    },
    include: { packagingType: { select: { code: true, name: true } } },
  });

  const poolAt = async (date: Date): Promise<PpwrPoolPoint[]> => {
    const rows = computeBalances(await loadAggregates([...sideMap.keys()], date), sideMap);
    const m = new Map<string, number>();
    for (const r of rows) if (r.confirmed > 0) m.set(r.packagingTypeId, (m.get(r.packagingTypeId) ?? 0) + r.confirmed);
    return [...m.entries()].map(([packagingTypeId, piecesAtPartners]) => ({ packagingTypeId, piecesAtPartners }));
  };
  const dayBefore = new Date(from.getTime() - 24 * 3600 * 1000);
  const [poolStart, poolEnd, pendingCount] = await Promise.all([
    poolAt(dayBefore),
    poolAt(to),
    prisma.movement.count({
      where: {
        status: { in: ["PROPOSED", "DISPUTED"] },
        kind: "ISSUE",
        date: { gte: from, lte: to },
        OR: [
          { partnershipId: { in: aIds }, fromSide: "A" },
          { partnershipId: { in: bIds }, fromSide: "B" },
        ],
      },
    }),
  ]);

  const result = computePpwr(
    lines.map((l) => ({
      packagingTypeId: l.packagingTypeId,
      code: l.packagingType.code,
      name: l.packagingType.name,
      reusable: l.reusable,
      weightKg: Number(l.weightKg),
      quantity: l.finalQuantity ?? l.quantity,
    })),
    poolStart,
    poolEnd,
  );
  return { ...result, from, to, pendingCount };
}
