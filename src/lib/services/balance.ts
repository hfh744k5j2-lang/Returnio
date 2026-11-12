import { Prisma, type Side } from "@prisma/client";
import { prisma } from "../db";
import type { Ctx } from "../context";
import { listPartners, type PartnerView } from "./partners";

/** Agregovaný řádek z databáze: součet kusů za partnerství × směr × stav × typ. */
export type BalanceAggRow = {
  partnershipId: string;
  fromSide: Side;
  status: "CONFIRMED" | "PROPOSED" | "DISPUTED";
  packagingTypeId: string;
  qty: number;
};

export type BalanceRow = {
  partnershipId: string;
  packagingTypeId: string;
  /** Potvrzené saldo. Kladné = partner má naše obaly (dluží nám). Záporné = máme obaly partnera. */
  confirmed: number;
  /** Vliv dosud nepotvrzených pohybů – navržené podle navrženého počtu, rozporované podle aktuálního návrhu opravy. */
  pending: number;
};

/**
 * Čistý výpočet salda z pohledu firmy. `mySide` říká, kterou stranou partnerství firma je.
 * Saldo = (kusy od nás k partnerovi) − (kusy od partnera k nám).
 */
export function computeBalances(rows: BalanceAggRow[], mySide: Map<string, Side>): BalanceRow[] {
  const map = new Map<string, BalanceRow>();
  for (const r of rows) {
    const side = mySide.get(r.partnershipId);
    if (!side) continue; // cizí partnerství nikdy nezapočítáme
    const key = `${r.partnershipId}|${r.packagingTypeId}`;
    const row = map.get(key) ?? { partnershipId: r.partnershipId, packagingTypeId: r.packagingTypeId, confirmed: 0, pending: 0 };
    const signed = r.fromSide === side ? r.qty : -r.qty;
    if (r.status === "CONFIRMED") row.confirmed += signed;
    else row.pending += signed;
    map.set(key, row);
  }
  return [...map.values()];
}

/** Načte agregace pro zadaná partnerství (ID musí pocházet z kontrolovaného výběru). */
export async function loadAggregates(partnershipIds: string[], asOf?: Date): Promise<BalanceAggRow[]> {
  if (partnershipIds.length === 0) return [];
  const dateFilter = asOf ? Prisma.sql`AND m."date" <= ${asOf}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { partnershipId: string; fromSide: Side; status: BalanceAggRow["status"]; packagingTypeId: string; qty: bigint }[]
  >(Prisma.sql`
    SELECT m."partnershipId", m."fromSide", m."status", l."packagingTypeId",
           SUM(CASE
                 WHEN m."status" = 'CONFIRMED' THEN COALESCE(l."finalQuantity", l."quantity")
                 WHEN m."status" = 'DISPUTED' THEN COALESCE((
                   SELECT (e->>'quantity')::int
                   FROM "MovementCorrection" c, jsonb_array_elements(c."lines") e
                   WHERE c."movementId" = m."id" AND c."status" = 'OPEN' AND e->>'packagingTypeId' = l."packagingTypeId"
                   LIMIT 1), l."quantity")
                 ELSE l."quantity" END) AS qty
    FROM "MovementLine" l
    JOIN "Movement" m ON m."id" = l."movementId"
    WHERE m."partnershipId" IN (${Prisma.join(partnershipIds)})
      AND m."status" IN ('CONFIRMED', 'PROPOSED', 'DISPUTED')
      AND l."reusable" = true -- nevratné obaly (kartony) se nevracejí, saldo nemají; slouží jen výkazu PPWR
      ${dateFilter}
    GROUP BY m."partnershipId", m."fromSide", m."status", l."packagingTypeId"
  `);
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
}

export type BalanceViewRow = BalanceRow & {
  partnerName: string;
  partnerCode: string;
  typeCode: string;
  typeName: string;
  ownerName: string;
  deposit: number | null;
  currency: string;
};

/** Saldo firmy z kontextu po partnerech a typech obalů. */
export async function getBalances(ctx: Ctx, opts: { partnershipId?: string; asOf?: Date } = {}) {
  const partners = await listPartners(ctx);
  const selected = opts.partnershipId ? partners.filter((p) => p.id === opts.partnershipId) : partners;
  const sideMap = new Map(selected.map((p) => [p.id, p.side]));
  const agg = await loadAggregates([...sideMap.keys()], opts.asOf);
  const rows = computeBalances(agg, sideMap).filter((r) => r.confirmed !== 0 || r.pending !== 0);
  const types = await prisma.packagingType.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.packagingTypeId))] } },
    include: { company: { select: { name: true } } },
  });
  const typeMap = new Map(types.map((t) => [t.id, t]));
  const partnerMap = new Map<string, PartnerView>(selected.map((p) => [p.id, p]));
  const result: BalanceViewRow[] = rows.map((r) => {
    const t = typeMap.get(r.packagingTypeId)!;
    const p = partnerMap.get(r.partnershipId)!;
    return {
      ...r,
      partnerName: p.name,
      partnerCode: p.code,
      typeCode: t.code,
      typeName: t.name,
      ownerName: t.company.name,
      deposit: t.deposit ? Number(t.deposit) : null,
      currency: t.currency,
    };
  });
  result.sort((a, b) => a.partnerName.localeCompare(b.partnerName, "cs") || a.typeCode.localeCompare(b.typeCode));
  return { rows: result, partners: selected };
}

/** Součet absolutních hodnot potvrzeného salda s partnerem (pro limit upozornění). */
export function totalAbsByPartner(rows: BalanceRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.partnershipId, (m.get(r.partnershipId) ?? 0) + Math.abs(r.confirmed));
  return m;
}
