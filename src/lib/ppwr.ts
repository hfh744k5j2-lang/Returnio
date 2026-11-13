/**
 * ORIENTAČNÍ výpočet pro výkaz PPWR (nařízení EU 2025/40 o obalech, čl. 29–31).
 *
 * EU zatím nevydala metodiku výpočtu (má ji vydat do 30. 6. 2027). CELÁ metodika – co se
 * započítává, co je „v oběhu“ a jak se počítají podíly a obrátky – je proto v tomto jednom
 * modulu jako čistá funkce nad surovými daty. Po vydání metodiky stačí vyměnit tento soubor.
 * (Služba `services/reports.ts` jen dodá všechny potvrzené řádky firmy a salda.)
 *
 * Zjednodušení verze "obalbook-2026-2":
 * - „Použité přepravní obaly“ = potvrzené VÝDEJE (od firmy k partnerovi) s datem v období,
 *   vratné i nevratné typy evidované v ObalBooku + ručně doplněné nevratné obaly mimo evidenci.
 *   Hmotnost a vratnost podle snímku v okamžiku zápisu pohybu.
 * - Podíl vratných = vratné / všechny, zvlášť v kusech a v kg.
 * - Obrátky typu = vydané kusy v období / průměrný počet kusů v oběhu u partnerů,
 *   „v oběhu“ = součet kladných potvrzených sald typu u partnerů, průměr ze začátku a konce období.
 */
export const PPWR_METHOD_VERSION = "obalbook-2026-2";

/** Potvrzený řádek pohybu, kde je firma stranou (surová data bez filtrování). */
export type PpwrRawLine = {
  kind: "ISSUE" | "RECEIPT" | "RETURN" | "LOSS" | "DAMAGE" | "CORRECTION";
  /** true = obaly šly od naší firmy k partnerovi */
  fromUs: boolean;
  date: Date;
  packagingTypeId: string;
  code: string;
  name: string;
  owner: string;
  reusable: boolean;
  weightKg: number;
  quantity: number;
};

/** Potvrzené saldo typu u jednoho partnera k datu (kladné = partner má naše/vydané obaly). */
export type PpwrBalance = { partnershipId: string; packagingTypeId: string; confirmed: number };

export type PpwrTypeRow = {
  key: string;
  packagingTypeId: string;
  code: string;
  name: string;
  owner: string;
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
  /** ručně doplněné nevratné obaly mimo evidenci */
  extraOneWayPieces: number;
  extraOneWayKg: number;
  /** 0–1, null pokud v období nebyl žádný výdej */
  reusableSharePieces: number | null;
  reusableShareWeight: number | null;
  types: PpwrTypeRow[];
};

/** Rozhodnutí metodiky: který řádek se počítá jako „použitý přepravní obal“. */
export function countsAsPlaced(l: PpwrRawLine, from: Date, to: Date): boolean {
  return l.kind === "ISSUE" && l.fromUs && l.date >= from && l.date <= to && l.quantity > 0;
}

/** Rozhodnutí metodiky: kolik kusů typu je „v oběhu“ u partnerů. */
export function poolOf(balances: PpwrBalance[], packagingTypeId: string): number {
  return balances.filter((b) => b.packagingTypeId === packagingTypeId && b.confirmed > 0).reduce((s, b) => s + b.confirmed, 0);
}

export function computePpwr(input: {
  lines: PpwrRawLine[];
  from: Date;
  to: Date;
  balancesAtStart: PpwrBalance[];
  balancesAtEnd: PpwrBalance[];
  extraOneWay?: { pieces: number; kg: number };
}): PpwrResult {
  const { from, to } = input;
  const byKey = new Map<string, PpwrTypeRow>();
  for (const l of input.lines) {
    if (!countsAsPlaced(l, from, to)) continue;
    // typ, který během období změnil vratnost, se vykáže ve dvou řádcích (podle snímku)
    const key = `${l.packagingTypeId}|${l.reusable ? 1 : 0}`;
    const row =
      byKey.get(key) ??
      { key, packagingTypeId: l.packagingTypeId, code: l.code, name: l.name, owner: l.owner, reusable: l.reusable, pieces: 0, weightKg: 0, avgPool: null, rotations: null };
    row.pieces += l.quantity;
    row.weightKg += l.quantity * l.weightKg;
    byKey.set(key, row);
  }
  for (const row of byKey.values()) {
    if (!row.reusable) continue;
    const avg = (poolOf(input.balancesAtStart, row.packagingTypeId) + poolOf(input.balancesAtEnd, row.packagingTypeId)) / 2;
    row.avgPool = avg;
    row.rotations = avg > 0 ? row.pieces / avg : null;
  }
  const types = [...byKey.values()].sort((a, b) => Number(b.reusable) - Number(a.reusable) || a.code.localeCompare(b.code) || a.owner.localeCompare(b.owner));
  const extraP = Math.max(0, Math.floor(input.extraOneWay?.pieces ?? 0));
  const extraKg = Math.max(0, input.extraOneWay?.kg ?? 0);
  const totalPieces = types.reduce((s, r) => s + r.pieces, 0) + extraP;
  const reusablePieces = types.filter((r) => r.reusable).reduce((s, r) => s + r.pieces, 0);
  const totalWeightKg = types.reduce((s, r) => s + r.weightKg, 0) + extraKg;
  const reusableWeightKg = types.filter((r) => r.reusable).reduce((s, r) => s + r.weightKg, 0);
  return {
    method: PPWR_METHOD_VERSION,
    totalPieces,
    reusablePieces,
    totalWeightKg,
    reusableWeightKg,
    extraOneWayPieces: extraP,
    extraOneWayKg: extraKg,
    reusableSharePieces: totalPieces > 0 ? reusablePieces / totalPieces : null,
    reusableShareWeight: totalWeightKg > 0 ? reusableWeightKg / totalWeightKg : null,
    types,
  };
}
