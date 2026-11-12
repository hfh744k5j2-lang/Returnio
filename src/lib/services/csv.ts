import Papa from "papaparse";
import type { MovementKind } from "@prisma/client";
import { prisma } from "../db";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { invalid } from "../errors";
import { audit } from "../audit";
import { getBalances } from "./balance";
import { createMovement, listAllMovements, safely, sendPartnerLink, type MovementFilters, FIXED_DIRECTION } from "./movements";
import { listPartners } from "./partners";
import { ppwrReport } from "./reports";

// ------------------------------------------------------------------ export

/** Ochrana proti CSV injection v Excelu (=, +, -, @ na začátku buňky). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV pro český Excel: středník, UTF-8 s BOM. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

const KIND_CS: Record<MovementKind, string> = {
  ISSUE: "výdej",
  RECEIPT: "příjem",
  RETURN: "vrácení",
  LOSS: "ztráta",
  DAMAGE: "poškození",
  CORRECTION: "úprava salda",
};
const STATUS_CS = { PROPOSED: "navržen", CONFIRMED: "potvrzen", DISPUTED: "rozporován", CANCELLED: "zrušen" } as const;

export async function exportMovementsCsv(ctx: Ctx, f: MovementFilters = {}) {
  assertCan(ctx.role, "export.run");
  const items = await listAllMovements(ctx, f);
  const rows: unknown[][] = [];
  for (const m of items) {
    for (const l of m.lines) {
      rows.push([
        m.numberLabel,
        m.date.toISOString().slice(0, 10),
        m.partnerName,
        KIND_CS[m.kind],
        m.direction === "OUT" ? "od nás" : "k nám",
        l.code,
        l.name,
        l.quantity,
        l.finalQuantity ?? "",
        STATUS_CS[m.status],
        m.deliveryNote ?? "",
        m.note ?? "",
      ]);
    }
  }
  return toCsv(
    ["cislo", "datum", "partner", "druh", "smer", "kod_obalu", "obal", "pocet_zapsany", "pocet_potvrzeny", "stav", "dodaci_list", "poznamka"],
    rows,
  );
}

export async function exportBalancesCsv(ctx: Ctx, opts: { partnershipId?: string; asOf?: Date } = {}) {
  assertCan(ctx.role, "export.run");
  const { rows } = await getBalances(ctx, opts);
  return toCsv(
    ["partner", "kod_partnera", "kod_obalu", "obal", "vlastnik_obalu", "saldo_potvrzene", "ceka_na_potvrzeni", "kauce_za_kus", "mena"],
    rows.map((r) => [r.partnerName, r.partnerCode, r.typeCode, r.typeName, r.ownerName, r.confirmed, r.pending, r.deposit ?? "", r.currency]),
  );
}

export async function exportPpwrCsv(ctx: Ctx, from: Date, to: Date) {
  const r = await ppwrReport(ctx, from, to);
  const pct = (x: number | null) => (x === null ? "" : (x * 100).toFixed(1));
  return toCsv(
    ["kod_obalu", "obal", "vratny", "vydano_ks", "hmotnost_kg", "prumer_v_obehu_ks", "obratky"],
    [
      ...r.types.map((t) => [t.code, t.name, t.reusable ? "ano" : "ne", t.pieces, t.weightKg.toFixed(3), t.avgPool ?? "", t.rotations?.toFixed(2) ?? ""]),
      [],
      ["CELKEM", "", "", r.totalPieces, r.totalWeightKg.toFixed(3), "", ""],
      ["podil_vratnych_ks_%", pct(r.reusableSharePieces)],
      ["podil_vratnych_kg_%", pct(r.reusableShareWeight)],
      ["metoda", r.method, "ORIENTAČNÍ VÝPOČET – EU metodiku zatím nevydala"],
    ],
  );
}

// ------------------------------------------------------------------ import

export const IMPORT_FIELDS = ["date", "partner", "kind", "packaging", "quantity", "deliveryNote", "direction", "note"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Partial<Record<ImportField, string>>;
const REQUIRED: ImportField[] = ["date", "partner", "kind", "packaging", "quantity"];
const MAX_ROWS = 5000;

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.length > 3_000_000) throw invalid("Soubor je příliš velký (max. 3 MB).");
  const r = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (r.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) throw invalid("Soubor nemá hlavičku se sloupci.");
  if (r.data.length > MAX_ROWS) throw invalid(`Soubor má víc než ${MAX_ROWS} řádků. Rozdělte ho prosím.`);
  return { headers, rows: r.data };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Odhad mapování podle názvů sloupců (cz/en/pl). */
export function guessMapping(headers: string[]): ImportMapping {
  const hints: Record<ImportField, string[]> = {
    date: ["datum", "date", "data", "den"],
    partner: ["partner", "odberatel", "dodavatel", "zakaznik", "customer", "kontrahent", "firma"],
    kind: ["druh", "typpohybu", "pohyb", "kind", "type", "operace", "rodzaj"],
    packaging: ["kodobalu", "obal", "packaging", "kod", "code", "opakowanie", "artikl"],
    quantity: ["pocet", "mnozstvi", "ks", "quantity", "qty", "ilosc"],
    deliveryNote: ["dodacilist", "dl", "deliverynote", "doklad", "wz"],
    direction: ["smer", "direction", "kierunek"],
    note: ["poznamka", "note", "uwagi"],
  };
  const out: ImportMapping = {};
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && hints[f].some((k) => norm(x) === k))
      ?? headers.find((x) => !used.has(x) && hints[f].some((k) => norm(x).includes(k)));
    if (h) {
      out[f] = h;
      used.add(h);
    }
  }
  return out;
}

const KIND_WORDS: Record<string, MovementKind> = {
  issue: "ISSUE", vydej: "ISSUE", expedice: "ISSUE", wydanie: "ISSUE", out: "ISSUE",
  receipt: "RECEIPT", prijem: "RECEIPT", przyjecie: "RECEIPT", in: "RECEIPT",
  return: "RETURN", vraceni: "RETURN", vratka: "RETURN", zwrot: "RETURN",
  loss: "LOSS", ztrata: "LOSS", strata: "LOSS",
  damage: "DAMAGE", poskozeni: "DAMAGE", uszkodzenie: "DAMAGE",
  correction: "CORRECTION", oprava: "CORRECTION", upravasalda: "CORRECTION", korekta: "CORRECTION",
};
const DIR_WORDS: Record<string, "IN" | "OUT"> = {
  in: "IN", knam: "IN", odpartnera: "IN", prijato: "IN", unas: "OUT",
  out: "OUT", odnas: "OUT", kpartnerovi: "OUT", upartnera: "IN",
};

export function parseDate(v: string): Date | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (m) return utc(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return utc(+m[3], +m[2], +m[1]);
  return null;
}
function utc(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

export type ImportRowError = { row: number; message: string };
type Group = {
  key: string;
  partnershipId: string;
  kind: MovementKind;
  direction?: "IN" | "OUT";
  date: Date;
  deliveryNote?: string;
  note?: string;
  lines: Map<string, number>;
  rows: number[];
};

/** Validace a seskupení řádků do pohybů (bez zápisu). Řádky se stejným partnerem, dnem, druhem, směrem a DL = jeden pohyb. */
async function prepare(ctx: Ctx, text: string, mapping: ImportMapping) {
  assertCan(ctx.role, "import.run");
  const { headers, rows } = parseCsv(text);
  for (const f of REQUIRED) {
    if (!mapping[f]) throw invalid(`Přiřaďte sloupec pro pole „${FIELD_LABEL[f]}“.`);
    if (!headers.includes(mapping[f]!)) throw invalid(`Sloupec „${mapping[f]}“ v souboru není.`);
  }
  const partners = await listPartners(ctx);
  const partnerRecords = await prisma.partnership.findMany({ where: { id: { in: partners.map((p) => p.id) } } });
  const byKey = new Map<string, string>();
  for (const p of partners) {
    byKey.set(norm(p.code), p.id);
    byKey.set(norm(p.name), p.id);
  }
  for (const p of partnerRecords) if (p.companyAId === ctx.companyId) byKey.set(norm(p.invitedEmail), p.id);

  const companyIds = new Set<string>([ctx.companyId]);
  for (const p of partnerRecords) {
    companyIds.add(p.companyAId);
    if (p.companyBId) companyIds.add(p.companyBId);
  }
  const types = await prisma.packagingType.findMany({ where: { companyId: { in: [...companyIds] } } });
  const errors: ImportRowError[] = [];
  const groups = new Map<string, Group>();
  const col = (r: Record<string, string>, f: ImportField) => (mapping[f] ? String(r[mapping[f]!] ?? "").trim() : "");

  rows.forEach((r, i) => {
    const rowNo = i + 2; // 1 = hlavička
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const date = parseDate(col(r, "date"));
    if (!date) return fail(`Neplatné datum „${col(r, "date")}“ (použijte 2026-03-31 nebo 31.3.2026).`);
    if (date.getTime() > Date.now() + 24 * 3600 * 1000) return fail("Datum je v budoucnosti.");
    const partnershipId = byKey.get(norm(col(r, "partner")));
    if (!partnershipId) return fail(`Neznámý partner „${col(r, "partner")}“ (použijte kód, název nebo e-mail partnera).`);
    const kind = KIND_WORDS[norm(col(r, "kind"))];
    if (!kind) return fail(`Neznámý druh pohybu „${col(r, "kind")}“ (výdej, příjem, vrácení, ztráta, poškození, oprava).`);
    let direction: "IN" | "OUT" | undefined = FIXED_DIRECTION[kind];
    if (!direction) {
      direction = DIR_WORDS[norm(col(r, "direction"))];
      if (!direction) return fail(`U druhu „${col(r, "kind")}“ vyplňte směr (k nám / od nás).`);
    }
    const p = partnerRecords.find((x) => x.id === partnershipId)!;
    const allowedCompanies = [p.companyAId, p.companyBId].filter(Boolean);
    const code = col(r, "packaging").toUpperCase();
    // přednost má vlastní typ; jinak typ partnera
    const type =
      types.find((t) => t.code === code && t.companyId === ctx.companyId) ??
      types.find((t) => t.code === code && allowedCompanies.includes(t.companyId));
    if (!type) return fail(`Neznámý kód obalu „${col(r, "packaging")}“.`);
    const qRaw = col(r, "quantity").replace(/\s/g, "").replace(",", ".");
    const q = Number(qRaw);
    if (!Number.isInteger(q) || q < 1 || q > 1_000_000) return fail(`Počet „${col(r, "quantity")}“ musí být celé číslo od 1.`);
    const deliveryNote = col(r, "deliveryNote").slice(0, 60) || undefined;
    const key = [partnershipId, date.toISOString().slice(0, 10), kind, direction, deliveryNote ?? ""].join("|");
    const g =
      groups.get(key) ??
      { key, partnershipId, kind, direction: FIXED_DIRECTION[kind] ? undefined : direction, date, deliveryNote, note: col(r, "note").slice(0, 1000) || undefined, lines: new Map<string, number>(), rows: [] as number[] };
    g.lines.set(type.id, (g.lines.get(type.id) ?? 0) + q);
    g.rows.push(rowNo);
    groups.set(key, g);
  });
  return { rows: rows.length, errors, groups: [...groups.values()] };
}

const FIELD_LABEL: Record<ImportField, string> = {
  date: "Datum",
  partner: "Partner",
  kind: "Druh pohybu",
  packaging: "Kód obalu",
  quantity: "Počet",
  deliveryNote: "Dodací list",
  direction: "Směr",
  note: "Poznámka",
};

export async function previewImport(ctx: Ctx, text: string, mapping: ImportMapping) {
  const { rows, errors, groups } = await prepare(ctx, text, mapping);
  return { rows, movements: groups.length, errors: errors.slice(0, 200), errorCount: errors.length };
}

/** Import: vše, nebo nic. Pohyby vznikají jako navržené – partner je musí potvrdit. */
export async function runImport(ctx: Ctx, text: string, mapping: ImportMapping, fileName: string) {
  const { rows, errors, groups } = await prepare(ctx, text, mapping);
  if (errors.length) throw invalid(`Soubor obsahuje ${errors.length} chyb. Opravte je a zkuste to znovu.`, errors.slice(0, 200));
  if (groups.length === 0) throw invalid("Soubor neobsahuje žádné pohyby.");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const batch = await tx.importBatch.create({
            data: { companyId: ctx.companyId, createdById: ctx.userId, fileName: fileName.slice(0, 200), rowCount: rows, movementCount: groups.length },
          });
          const ids: string[] = [];
          for (const g of groups) {
            const m = await createMovement(
              ctx,
              {
                partnershipId: g.partnershipId,
                kind: g.kind,
                direction: g.direction,
                date: g.date,
                deliveryNote: g.deliveryNote,
                note: g.note,
                lines: [...g.lines.entries()].map(([packagingTypeId, quantity]) => ({ packagingTypeId, quantity })),
              },
              { importBatchId: batch.id, tx },
            );
            ids.push(m.id);
          }
          await audit(tx, {
            actor: { userId: ctx.userId },
            companyId: ctx.companyId,
            action: "import.completed",
            entityType: "ImportBatch",
            entityId: batch.id,
            data: { fileName, rows, movements: groups.length },
          });
          return { batchId: batch.id, ids };
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      // neregistrovaným partnerům pošleme odkazy až po úspěšném zápisu
      for (const id of result.ids) await safely(() => sendPartnerLink(id));
      return { batchId: result.batchId, movements: result.ids.length, rows };
    } catch (e) {
      lastError = e;
      const code = typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
      if (code !== "P2002") throw e; // kolize čísla se souběžným zápisem → zkusit znovu
    }
  }
  throw lastError;
}
