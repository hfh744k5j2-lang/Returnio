/**
 * ORIENTAČNÍ výpočet pro výkaz PPWR (nařízení EU 2025/40 o obalech, čl. 29–31).
 *
 * EU zatím nevydala metodiku výpočtu (má ji vydat do 30. 6. 2027). Celý výpočet je proto
 * v tomto jednom modulu jako čistá funkce, aby šel po vydání metodiky vyměnit bez zásahu jinam.
 *
 * Použitá zjednodušení (verze "obalbook-2026-1"):
 * - „Použité přepravní obaly“ = potvrzené VÝDEJE firmy partnerům s datem v období
 *   (vratné i nevratné typy; hmotnost a vratnost podle snímku v okamžiku zápisu pohybu).
 * - Podíl vratných = vratné / všechny, zvlášť v kusech a v kg.
 * - Obrátky typu = vydané kusy v období / průměrný počet kusů v oběhu u partnerů,
 *   kde „v oběhu“ = součet kladných potvrzených sald typu u všech partnerů, průměr ze stavu
 *   na začátku a na konci období. Pokud je oběh 0, obrátky nelze určit.
 */
export const PPWR_METHOD_VERSION = "obalbook-2026-1";

export type PpwrIssueLine = {
  packagingTypeId: string;
  code: string;
  name: string;
  reusable: boolean;
  weightKg: number;
  quantity: number;
};

export type PpwrPoolPoint = { packagingTypeId: string; piecesAtPartners: number };

export type PpwrTypeRow = {
  packagingTypeId: string;
  code: string;
  name: string;
  reusable: boolean;
  pieces: number;
  weightKg: number;
  avgPool: number | null;
  rotations: number | null;
};

export type PpwrResult = {
  method: string;
  totalPieces: number;
  reusablePieces: number;
  totalWeightKg: number;
  reusableWeightKg: number;
  /** 0–1, null pokud v období nebyl žádný výdej */
  reusableSharePieces: number | null;
  reusableShareWeight: number | null;
  types: PpwrTypeRow[];
};

export function computePpwr(lines: PpwrIssueLine[], poolStart: PpwrPoolPoint[], poolEnd: PpwrPoolPoint[]): PpwrResult {
  const byType = new Map<string, PpwrTypeRow>();
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    const row =
      byType.get(l.packagingTypeId) ??
      { packagingTypeId: l.packagingTypeId, code: l.code, name: l.name, reusable: l.reusable, pieces: 0, weightKg: 0, avgPool: null, rotations: null };
    // vratnost bereme ze snímku řádku; když se typ během období změnil, převáží novější řádek
    row.reusable = l.reusable;
    row.pieces += l.quantity;
    row.weightKg += l.quantity * l.weightKg;
    byType.set(l.packagingTypeId, row);
  }
  const pool = (pts: PpwrPoolPoint[], id: string) => Math.max(0, pts.find((p) => p.packagingTypeId === id)?.piecesAtPartners ?? 0);
  for (const row of byType.values()) {
    if (!row.reusable) continue;
    const avg = (pool(poolStart, row.packagingTypeId) + pool(poolEnd, row.packagingTypeId)) / 2;
    row.avgPool = avg;
    row.rotations = avg > 0 ? row.pieces / avg : null;
  }
  const types = [...byType.values()].sort((a, b) => Number(b.reusable) - Number(a.reusable) || a.code.localeCompare(b.code));
  const totalPieces = types.reduce((s, r) => s + r.pieces, 0);
  const reusablePieces = types.filter((r) => r.reusable).reduce((s, r) => s + r.pieces, 0);
  const totalWeightKg = types.reduce((s, r) => s + r.weightKg, 0);
  const reusableWeightKg = types.filter((r) => r.reusable).reduce((s, r) => s + r.weightKg, 0);
  return {
    method: PPWR_METHOD_VERSION,
    totalPieces,
    reusablePieces,
    totalWeightKg,
    reusableWeightKg,
    reusableSharePieces: totalPieces > 0 ? reusablePieces / totalPieces : null,
    reusableShareWeight: totalWeightKg > 0 ? reusableWeightKg / totalWeightKg : null,
    types,
  };
}
