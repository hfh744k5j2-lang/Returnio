import { z } from "zod";
import type { MovementKind, MovementStatus, Prisma, Role, Side } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { audit, type Actor } from "../audit";
import type { Ctx } from "../context";
import { assertCan, can } from "../permissions";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { appUrl, hashToken, newToken } from "../tokens";
import { sendEmail } from "../email";
import { parse } from "./validate";
import { getPartnershipRaw, notifyEmailsForSide, otherSide, partnershipScope, sideOf } from "./partners";

export const MOVEMENT_KINDS: MovementKind[] = ["ISSUE", "RECEIPT", "RETURN", "LOSS", "DAMAGE", "CORRECTION"];
/** Druhy, které smí zapsat i skladník. */
export const BASIC_KINDS: MovementKind[] = ["ISSUE", "RECEIPT", "RETURN"];

/**
 * Směr vůči autorovi: OUT = obaly jdou od autora k partnerovi (partner dluží autorovi víc),
 * IN = od partnera k autorovi. Výdej a příjem mají směr pevný, ostatní druhy si autor volí.
 */
export type Direction = "OUT" | "IN";
export const FIXED_DIRECTION: Partial<Record<MovementKind, Direction>> = { ISSUE: "OUT", RECEIPT: "IN" };
export const DEFAULT_DIRECTION: Record<MovementKind, Direction> = {
  ISSUE: "OUT",
  RECEIPT: "IN",
  RETURN: "IN",
  LOSS: "IN",
  DAMAGE: "IN",
  CORRECTION: "OUT",
};

export function formatMovementNumber(n: number) {
  return `P-${String(n).padStart(6, "0")}`;
}

export const LINK_VALID_DAYS = 14;
const MAX_QTY = 1_000_000;

/** Počet: číslo nebo číselný řetězec (ne true/false/null). */
const qtyInput = (v: unknown) => (typeof v === "number" || typeof v === "string" ? v : NaN);

const lineSchema = z.object({
  packagingTypeId: z.string().min(1),
  quantity: z.preprocess(qtyInput, z.coerce
    .number({ invalid_type_error: "Počet musí být číslo." })
    .int("Počet musí být celé číslo.")
    .min(1, "Počet musí být alespoň 1.")
    .max(MAX_QTY, "Počet je příliš velký.")),
});

const dateSchema = z.coerce
  .date({ invalid_type_error: "Neplatné datum." })
  .refine((d) => d.getFullYear() >= 2000, "Datum je příliš staré.")
  // tolerance 1 den kvůli časovým pásmům (zákazníci v CZ/SK/PL)
  .refine((d) => d.getTime() <= Date.now() + 24 * 3600 * 1000, "Datum nesmí být v budoucnosti.");

export const createMovementSchema = z.object({
  partnershipId: z.string().min(1, "Vyberte partnera."),
  kind: z.enum(["ISSUE", "RECEIPT", "RETURN", "LOSS", "DAMAGE", "CORRECTION"], {
    errorMap: () => ({ message: "Vyberte druh pohybu." }),
  }),
  direction: z.enum(["OUT", "IN"]).optional(),
  date: dateSchema,
  deliveryNote: z.string().trim().max(60).optional(),
  note: z.string().trim().max(1000).optional(),
  clientKey: z.string().trim().max(64).optional(),
  lines: z
    .array(lineSchema)
    .min(1, "Přidejte alespoň jeden obal s počtem.")
    .max(50)
    .refine((ls) => new Set(ls.map((l) => l.packagingTypeId)).size === ls.length, "Každý typ obalu zadejte jen jednou."),
});

export type CreateMovementInput = z.input<typeof createMovementSchema>;

const correctionSchema = z.object({
  reason: z.string().trim().min(3, "Napište důvod (alespoň 3 znaky).").max(1000),
  lines: z
    .array(
      z.object({
        packagingTypeId: z.string().min(1),
        quantity: z.preprocess(qtyInput, z.coerce
          .number({ invalid_type_error: "Počet musí být číslo." })
          .int("Počet musí být celé číslo.")
          .min(0, "Počet nesmí být záporný.")
          .max(MAX_QTY, "Počet je příliš velký.")),
      }),
    )
    .min(1),
});

/** Kdo jedná: přihlášený uživatel firmy, nebo partner přes jednorázový odkaz. */
type Acting = { side: Side; actor: Actor; companyId: string | null; role: Role | null };

function directionToFromSide(creator: Side, dir: Direction): Side {
  return dir === "OUT" ? creator : otherSide(creator);
}

// ---------------------------------------------------------------- vytvoření

function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

/** Upozornění po uložení: chyba odeslání se zaloguje, ale neshodí již provedenou akci. */
export async function safely(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error("[notify] odeslání upozornění selhalo", e);
  }
}

export async function createMovement(ctx: Ctx, input: unknown, opts: { importBatchId?: string; tx?: Tx } = {}) {
  assertCan(ctx.role, "movements.create");
  const data = parse(createMovementSchema, input);
  if (!BASIC_KINDS.includes(data.kind)) assertCan(ctx.role, "movements.createSpecial");
  // uvnitř importu čteme přes transakci (jedno připojení – bezpečné i s poolerem connection_limit=1)
  const db = opts.tx ?? prisma;
  const p = opts.tx
    ? await opts.tx.partnership.findFirst({ where: { id: data.partnershipId, ...partnershipScope(ctx.companyId) }, include: { companyA: true, companyB: true } })
    : await getPartnershipRaw(ctx, data.partnershipId);
  if (!p) throw notFound("Partner");
  const side = sideOf(p, ctx.companyId);
  if (data.clientKey) {
    // dvojí odeslání formuláře → vrátíme už uložený pohyb
    const existing = await db.movement.findFirst({ where: { partnershipId: p.id, clientKey: data.clientKey }, include: { lines: true } });
    if (existing) return existing;
  }
  const fixed = FIXED_DIRECTION[data.kind];
  if (fixed && data.direction && data.direction !== fixed) throw invalid("Pro tento druh pohybu nelze zvolit směr.");
  const direction = fixed ?? data.direction;
  if (!direction) throw invalid("Zvolte směr pohybu.");

  // Typy obalů musí patřit jedné ze stran partnerství (žádné cizí ID).
  const companyIds = [p.companyAId, p.companyBId].filter((x): x is string => Boolean(x));
  const types = await db.packagingType.findMany({
    // i neaktivní typ – jinak by nešlo vrátit obaly, které u partnera zůstaly
    where: { id: { in: data.lines.map((l) => l.packagingTypeId) }, companyId: { in: companyIds } },
  });
  if (types.length !== data.lines.length) throw invalid("Neznámý typ obalu.");
  // deaktivovaný typ už nevydáváme; vrátit / odepsat ho jde (aby saldo šlo uzavřít)
  if (data.kind === "ISSUE" && types.some((t) => !t.active)) throw invalid("Tento typ obalu je vyřazený – nelze ho vydat.");

  const typeMap = new Map(types.map((t) => [t.id, t]));
  const run = async (tx: Tx) => {
    // číslo v rámci partnerství: zámek řádku partnerství serializuje souběžné zápisy (ruční i import);
    // pro jistotu ještě unikátní index + opakování níže
    await tx.$queryRaw`SELECT "id" FROM "Partnership" WHERE "id" = ${p.id} FOR UPDATE`;
    const last = await tx.movement.aggregate({ where: { partnershipId: p.id }, _max: { number: true } });
    const m = await tx.movement.create({
      data: {
        number: (last._max.number ?? 0) + 1,
        partnershipId: p.id,
        kind: data.kind,
        createdBySide: side,
        fromSide: directionToFromSide(side, direction),
        date: data.date,
        deliveryNote: data.deliveryNote || null,
        note: data.note || null,
        createdById: ctx.userId,
        importBatchId: opts.importBatchId ?? null,
        clientKey: data.clientKey || null,
        lines: {
          create: data.lines.map((l) => ({
            packagingTypeId: l.packagingTypeId,
            quantity: l.quantity,
            weightKg: typeMap.get(l.packagingTypeId)!.weightKg,
            reusable: typeMap.get(l.packagingTypeId)!.reusable,
          })),
        },
      },
      include: { lines: true },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      partnershipId: p.id,
      action: "movement.created",
      entityType: "Movement",
      entityId: m.id,
      data: {
        number: m.number,
        kind: m.kind,
        direction,
        date: data.date.toISOString().slice(0, 10),
        deliveryNote: m.deliveryNote,
        lines: data.lines,
        ...(opts.importBatchId ? { source: "import" } : {}),
      },
    });
    return m;
  };
  let m: Awaited<ReturnType<typeof run>> | undefined;
  if (opts.tx) m = await run(opts.tx);
  else {
    for (let attempt = 0; !m; attempt++) {
      try {
        m = await prisma.$transaction(run);
      } catch (e) {
        if (data.clientKey && isUniqueViolation(e)) {
          const existing = await prisma.movement.findFirst({ where: { partnershipId: p.id, clientKey: data.clientKey }, include: { lines: true } });
          if (existing) return existing;
        }
        if (attempt < 5 && isUniqueViolation(e)) continue;
        throw e;
      }
    }
  }

  // Neregistrovaný partner dostane jednorázový odkaz k potvrzení (chyba e-mailu pohyb nezruší).
  if (!p.companyBId && !opts.tx) await safely(() => sendPartnerLink(m.id));
  return m;
}

/**
 * Znovu poslat jednorázový odkaz neregistrovanému partnerovi (staré odkazy k pohybu přestanou platit).
 * Jen pro pohyb, kde je na tahu partner (navržený námi, nebo rozpor s naším návrhem opravy).
 */
export async function resendPartnerLink(ctx: Ctx, id: string) {
  assertCan(ctx.role, "disputes.resolve");
  const m = await loadScoped(ctx, id);
  const open = m.corrections.find((c) => c.status === "OPEN");
  const partnerTurn = (m.status === "PROPOSED" && m.createdBySide === "A") || (m.status === "DISPUTED" && open?.proposedBySide === "A");
  if (m.partnership.companyBId || !partnerTurn) throw invalid("Odkaz teď nelze poslat – partner je registrovaný, nebo na tahu není.");
  await prisma.partnerLinkToken.updateMany({ where: { movementId: m.id, usedAt: null }, data: { expiresAt: new Date() } });
  await audit(prisma, {
    actor: { userId: ctx.userId },
    companyId: ctx.companyId,
    partnershipId: m.partnershipId,
    action: "movement.link_resent",
    entityType: "Movement",
    entityId: m.id,
  });
  await sendPartnerLink(m.id);
}

/** Pohyby, u kterých čeká neregistrovaný partner – po změně jeho e-mailu jim pošleme nové odkazy. */
export async function resendAllPartnerLinks(partnershipId: string) {
  const waiting = await prisma.movement.findMany({
    where: {
      partnershipId,
      partnership: { companyBId: null },
      OR: [
        { status: "PROPOSED", createdBySide: "A" },
        { status: "DISPUTED", corrections: { some: { status: "OPEN", proposedBySide: "A" } } },
      ],
    },
    select: { id: true },
  });
  for (const w of waiting) await safely(() => sendPartnerLink(w.id));
  return waiting.length;
}

/** Vytvoří jednorázový odkaz pro neregistrovaného partnera a pošle ho e-mailem. */
export async function sendPartnerLink(movementId: string) {
  const m = await prisma.movement.findUniqueOrThrow({
    where: { id: movementId },
    include: {
      partnership: { include: { companyA: true } },
      lines: { include: { packagingType: true } },
      corrections: { where: { status: "OPEN" } },
    },
  });
  if (m.partnership.companyBId) return null;
  const open = m.corrections[0];
  // odkaz jen když je partner na tahu (navržený pohyb firmy A, nebo rozpor s návrhem firmy A)
  const partnerTurn = (m.status === "PROPOSED" && m.createdBySide === "A") || (m.status === "DISPUTED" && open?.proposedBySide === "A");
  if (!partnerTurn) return null;
  const proposed = new Map(((open?.lines ?? []) as { packagingTypeId: string; quantity: number }[]).map((l) => [l.packagingTypeId, l.quantity]));
  const { token, hash } = newToken();
  // u jednoho pohybu platí vždy jen nejnovější odkaz
  await prisma.partnerLinkToken.updateMany({ where: { movementId: m.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
  await audit(prisma, {
    actor: { label: "systém" },
    partnershipId: m.partnershipId,
    action: "movement.link_sent",
    entityType: "Movement",
    entityId: m.id,
    data: { to: "partner" },
  });
  await prisma.partnerLinkToken.create({
    data: {
      tokenHash: hash,
      partnershipId: m.partnershipId,
      movementId: m.id,
      expiresAt: new Date(Date.now() + LINK_VALID_DAYS * 24 * 3600 * 1000),
    },
  });
  const url = appUrl(`/p/${token}`);
  const lines =
    m.lines.map((l) => `  - ${l.packagingType.name} (${l.packagingType.code}): ${proposed.get(l.packagingTypeId) ?? l.quantity} ks`).join("\n") +
    (open ? `\nDůvod: ${open.reason}` : "");
  const what = m.status === "DISPUTED" ? "navrhuje opravu pohybu" : "zapsala pohyb obalů";
  await sendEmail({
    to: m.partnership.invitedEmail,
    subject: `${m.partnership.companyA.name}: potvrďte pohyb obalů ${formatMovementNumber(m.number)}`,
    text:
      `Firma ${m.partnership.companyA.name} ${what} ${formatMovementNumber(m.number)} ` +
      `ze dne ${m.date.toISOString().slice(0, 10)}${m.deliveryNote ? `, dodací list ${m.deliveryNote}` : ""}:\n${lines}\n` +
      (m.note ? `Poznámka: ${m.note}\n` : "") +
      `\n` +
      `Potvrďte nebo rozporujte zde (bez registrace, odkaz platí ${LINK_VALID_DAYS} dní a lze ho použít jednou):\n${url}\n\n` +
      `---\nPlease confirm or dispute this packaging movement (no registration needed): ${url}`,
  });
  return url;
}

// ---------------------------------------------------------------- čtení

export type MovementFilters = {
  partnershipId?: string;
  status?: MovementStatus;
  kind?: MovementKind;
  from?: Date;
  to?: Date;
  q?: string;
  /** me = čeká na mé potvrzení, partner = čeká na partnera, dispute = rozpor čeká na mou reakci */
  awaiting?: "me" | "partner" | "dispute";
  page?: number;
  pageSize?: number;
};

export function movementScope(companyId: string): Prisma.MovementWhereInput {
  return { partnership: partnershipScope(companyId) };
}

/** Podmínky „vytvořeno mnou / partnerem“ podle toho, kterou stranou partnerství jsme. */
async function sideConditions(ctx: Ctx) {
  const ps = await prisma.partnership.findMany({ where: partnershipScope(ctx.companyId), select: { id: true, companyAId: true } });
  const aIds = ps.filter((p) => p.companyAId === ctx.companyId).map((p) => p.id);
  const bIds = ps.filter((p) => p.companyAId !== ctx.companyId).map((p) => p.id);
  const by = (mine: boolean): Prisma.MovementWhereInput => ({
    OR: [
      { partnershipId: { in: aIds }, createdBySide: mine ? "A" : "B" },
      { partnershipId: { in: bIds }, createdBySide: mine ? "B" : "A" },
    ],
  });
  const disputeForMe: Prisma.MovementWhereInput = {
    status: "DISPUTED",
    OR: [
      { partnershipId: { in: aIds }, corrections: { some: { status: "OPEN", proposedBySide: "B" } } },
      { partnershipId: { in: bIds }, corrections: { some: { status: "OPEN", proposedBySide: "A" } } },
    ],
  };
  return { createdByMe: by(true), createdByPartner: by(false), disputeForMe };
}

export async function movementCounters(ctx: Ctx) {
  const s = await sideConditions(ctx);
  const scope = movementScope(ctx.companyId);
  const [toConfirm, waitingForPartner, disputesForMe, disputesAll] = await Promise.all([
    prisma.movement.count({ where: { AND: [scope, s.createdByPartner, { status: "PROPOSED" }] } }),
    prisma.movement.count({ where: { AND: [scope, s.createdByMe, { status: "PROPOSED" }] } }),
    prisma.movement.count({ where: { AND: [scope, s.disputeForMe] } }),
    prisma.movement.count({ where: { AND: [scope, { status: "DISPUTED" }] } }),
  ]);
  return { toConfirm, waitingForPartner, disputesForMe, disputesAll };
}

async function buildWhere(ctx: Ctx, f: MovementFilters): Promise<Prisma.MovementWhereInput> {
  const and: Prisma.MovementWhereInput[] = [movementScope(ctx.companyId)];
  if (f.awaiting) {
    const s = await sideConditions(ctx);
    if (f.awaiting === "me") and.push(s.createdByPartner, { status: "PROPOSED" });
    if (f.awaiting === "partner") and.push(s.createdByMe, { status: "PROPOSED" });
    if (f.awaiting === "dispute") and.push(s.disputeForMe);
  }
  if (f.partnershipId) and.push({ partnershipId: f.partnershipId });
  if (f.status) and.push({ status: f.status });
  if (f.kind) and.push({ kind: f.kind });
  if (f.from) and.push({ date: { gte: f.from } });
  if (f.to) and.push({ date: { lte: f.to } });
  if (f.q) {
    const n = Number(f.q.replace(/^P-0*/i, ""));
    and.push({
      OR: [
        { deliveryNote: { contains: f.q, mode: "insensitive" } },
        { note: { contains: f.q, mode: "insensitive" } },
        ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      ],
    });
  }
  return { AND: and };
}

const movementInclude = {
  partnership: { include: { companyA: true, companyB: true } },
  lines: { include: { packagingType: { include: { company: { select: { id: true, name: true } } } } } },
  corrections: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MovementInclude;

type MovementFull = Prisma.MovementGetPayload<{ include: typeof movementInclude }>;

export type MovementView = ReturnType<typeof toMovementView>;

/** Pohled na pohyb z pohledu firmy z kontextu (směr, partner, co smí udělat). */
export function toMovementView(m: MovementFull, companyId: string | null, role: Role | null, asSide?: Side) {
  const mySide = asSide ?? sideOf(m.partnership, companyId ?? "");
  const partnerName =
    mySide === "A" ? (m.partnership.companyB?.name ?? m.partnership.invitedName) : m.partnership.companyA.name;
  const openCorrection = m.corrections.find((c) => c.status === "OPEN") ?? null;
  const iAmCreator = m.createdBySide === mySide;
  const isPending = m.status === "PROPOSED";
  const r = role ?? "SKLAD";
  const special = !BASIC_KINDS.includes(m.kind);
  const officeOk = !special || can(r, "movements.createSpecial");
  return {
    id: m.id,
    number: m.number,
    numberLabel: formatMovementNumber(m.number),
    kind: m.kind,
    status: m.status,
    date: m.date,
    deliveryNote: m.deliveryNote,
    note: m.note,
    createdAt: m.createdAt,
    confirmedAt: m.confirmedAt,
    confirmedByLabel: m.confirmedByLabel,
    partnershipId: m.partnershipId,
    partnerName,
    partnerRegistered: Boolean(m.partnership.companyBId),
    mySide,
    iAmCreator,
    /** OUT = obaly odešly od nás k partnerovi. */
    direction: (m.fromSide === mySide ? "OUT" : "IN") as Direction,
    lines: m.lines.map((l) => ({
      id: l.id,
      packagingTypeId: l.packagingTypeId,
      code: l.packagingType.code,
      name: l.packagingType.name,
      ownerName: l.packagingType.company.name,
      quantity: l.quantity,
      finalQuantity: l.finalQuantity,
    })),
    corrections: m.corrections.map((c) => ({
      id: c.id,
      byMe: c.proposedBySide === mySide,
      proposedByLabel: c.proposedByLabel,
      reason: c.reason,
      status: c.status,
      lines: c.lines as { packagingTypeId: string; quantity: number }[],
      createdAt: c.createdAt,
      decidedAt: c.decidedAt,
    })),
    openCorrection: openCorrection
      ? { id: openCorrection.id, byMe: openCorrection.proposedBySide === mySide }
      : null,
    can: {
      confirm: isPending && !iAmCreator && officeOk && can(r, "movements.confirm"),
      dispute: isPending && !iAmCreator && officeOk && can(r, "movements.dispute"),
      cancel: isPending && iAmCreator && officeOk && can(r, "movements.create"),
      resolve:
        m.status === "DISPUTED" && !!openCorrection && openCorrection.proposedBySide !== mySide && can(r, "disputes.resolve"),
    },
  };
}

export async function listMovements(ctx: Ctx, f: MovementFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 500);
  const page = Math.min(Math.max(f.page ?? 1, 1), 10_000);
  const where = await buildWhere(ctx, f);
  const [total, rows] = await Promise.all([
    prisma.movement.count({ where }),
    prisma.movement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, page, pageSize, items: rows.map((m) => toMovementView(m, ctx.companyId, ctx.role)) };
}

/** Pro export – všechny pohyby dle filtru (bez stránkování). */
export async function listAllMovements(ctx: Ctx, f: MovementFilters = {}) {
  const rows = await prisma.movement.findMany({
    where: await buildWhere(ctx, f),
    include: movementInclude,
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  return rows.map((m) => toMovementView(m, ctx.companyId, ctx.role));
}

async function loadScoped(ctx: Ctx, id: string): Promise<MovementFull> {
  if (typeof id !== "string" || !id) throw notFound("Pohyb");
  const m = await prisma.movement.findFirst({ where: { id, ...movementScope(ctx.companyId) }, include: movementInclude });
  if (!m) throw notFound("Pohyb");
  return m;
}

export async function getMovement(ctx: Ctx, id: string) {
  return toMovementView(await loadScoped(ctx, id), ctx.companyId, ctx.role);
}

function actingFromCtx(ctx: Ctx, m: MovementFull): Acting {
  return { side: sideOf(m.partnership, ctx.companyId), actor: { userId: ctx.userId }, companyId: ctx.companyId, role: ctx.role };
}

// ---------------------------------------------------------------- potvrzení / rozpor / vyřešení

async function setStatus(tx: Tx, id: string, expected: MovementStatus, data: Prisma.MovementUpdateManyMutationInput) {
  const r = await tx.movement.updateMany({ where: { id, status: expected }, data });
  if (r.count !== 1) throw conflict("Pohyb mezitím změnil stav. Obnovte stránku.");
}

async function doConfirm(m: MovementFull, a: Acting) {
  if (m.status !== "PROPOSED") throw conflict("Pohyb už není ve stavu „navržen“.");
  if (m.createdBySide === a.side) throw forbidden("Vlastní pohyb nemůžete potvrdit – potvrzuje ho partner.");
  await prisma.$transaction(async (tx) => {
    await setStatus(tx, m.id, "PROPOSED", {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedById: a.actor.userId ?? null,
      confirmedByLabel: a.actor.label ?? null,
    });
    for (const l of m.lines) {
      await tx.movementLine.update({ where: { id: l.id }, data: { finalQuantity: l.quantity } });
    }
    await audit(tx, {
      actor: a.actor,
      companyId: a.companyId,
      partnershipId: m.partnershipId,
      action: "movement.confirmed",
      entityType: "Movement",
      entityId: m.id,
    });
  });
}

function normalizeCorrection(m: MovementFull, input: unknown) {
  const data = parse(correctionSchema, input);
  const byType = new Map(data.lines.map((l) => [l.packagingTypeId, l.quantity]));
  for (const id of byType.keys()) {
    if (!m.lines.some((l) => l.packagingTypeId === id)) throw invalid("Opravit lze jen obaly, které jsou v pohybu.");
  }
  // neuvedené položky = aktuálně navržený počet (ne původní)
  const cur = currentProposal(m);
  const lines = m.lines.map((l) => ({
    packagingTypeId: l.packagingTypeId,
    quantity: byType.get(l.packagingTypeId) ?? cur.get(l.packagingTypeId) ?? l.quantity,
  }));
  return { reason: data.reason, lines };
}

function currentProposal(m: MovementFull): Map<string, number> {
  const open = m.corrections.find((c) => c.status === "OPEN");
  if (open) return new Map((open.lines as { packagingTypeId: string; quantity: number }[]).map((l) => [l.packagingTypeId, l.quantity]));
  return new Map(m.lines.map((l) => [l.packagingTypeId, l.quantity]));
}

async function doDispute(m: MovementFull, a: Acting, input: unknown) {
  if (m.status !== "PROPOSED") throw conflict("Rozporovat lze jen navržený pohyb.");
  if (m.createdBySide === a.side) throw forbidden("Vlastní pohyb nemůžete rozporovat. Můžete ho zrušit.");
  const c = normalizeCorrection(m, input);
  const cur = currentProposal(m);
  if (c.lines.every((l) => cur.get(l.packagingTypeId) === l.quantity))
    throw invalid("Opravený počet je stejný jako původní. Pokud souhlasíte, pohyb potvrďte.");
  const corr = await prisma.$transaction(async (tx) => {
    await setStatus(tx, m.id, "PROPOSED", { status: "DISPUTED" });
    const corr = await tx.movementCorrection.create({
      data: {
        movementId: m.id,
        proposedBySide: a.side,
        proposedById: a.actor.userId ?? null,
        proposedByLabel: a.actor.label ?? null,
        reason: c.reason,
        lines: c.lines,
      },
    });
    await audit(tx, {
      actor: a.actor,
      companyId: a.companyId,
      partnershipId: m.partnershipId,
      action: "movement.disputed",
      entityType: "Movement",
      entityId: m.id,
      data: { correctionId: corr.id, reason: c.reason, lines: c.lines },
    });
    return corr;
  });
  await safely(() => notifyDispute(m.id, corr.id, otherSide(a.side)));
  return corr;
}

async function doAccept(m: MovementFull, a: Acting) {
  const open = m.corrections.find((c) => c.status === "OPEN");
  if (m.status !== "DISPUTED" || !open) throw conflict("Pohyb nemá otevřený návrh opravy.");
  if (open.proposedBySide === a.side) throw forbidden("Vlastní návrh opravy musí schválit partner.");
  const lines = open.lines as { packagingTypeId: string; quantity: number }[];
  await prisma.$transaction(async (tx) => {
    const r = await tx.movementCorrection.updateMany({
      where: { id: open.id, status: "OPEN" },
      data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: a.actor.userId ?? null, decidedByLabel: a.actor.label ?? null },
    });
    if (r.count !== 1) throw conflict("Návrh opravy mezitím změnil stav. Obnovte stránku.");
    await setStatus(tx, m.id, "DISPUTED", {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedById: a.actor.userId ?? null,
      confirmedByLabel: a.actor.label ?? null,
    });
    for (const l of m.lines) {
      const q = lines.find((x) => x.packagingTypeId === l.packagingTypeId)?.quantity ?? l.quantity;
      await tx.movementLine.update({ where: { id: l.id }, data: { finalQuantity: q } });
    }
    await audit(tx, {
      actor: a.actor,
      companyId: a.companyId,
      partnershipId: m.partnershipId,
      action: "movement.dispute_resolved",
      entityType: "Movement",
      entityId: m.id,
      data: { correctionId: open.id, lines },
    });
  });
}

async function doCounter(m: MovementFull, a: Acting, input: unknown) {
  const open = m.corrections.find((c) => c.status === "OPEN");
  if (m.status !== "DISPUTED" || !open) throw conflict("Pohyb nemá otevřený návrh opravy.");
  if (open.proposedBySide === a.side) throw forbidden("Na vlastní návrh nelze odpovídat. Počkejte na partnera.");
  const c = normalizeCorrection(m, input);
  const cur = currentProposal(m);
  if (c.lines.every((l) => cur.get(l.packagingTypeId) === l.quantity))
    throw invalid("Návrh je stejný jako partnerův. Pokud souhlasíte, návrh přijměte.");
  const corr = await prisma.$transaction(async (tx) => {
    const r = await tx.movementCorrection.updateMany({
      where: { id: open.id, status: "OPEN" },
      data: { status: "SUPERSEDED", decidedAt: new Date(), decidedById: a.actor.userId ?? null, decidedByLabel: a.actor.label ?? null },
    });
    if (r.count !== 1) throw conflict("Návrh opravy mezitím změnil stav. Obnovte stránku.");
    const corr = await tx.movementCorrection.create({
      data: {
        movementId: m.id,
        proposedBySide: a.side,
        proposedById: a.actor.userId ?? null,
        proposedByLabel: a.actor.label ?? null,
        reason: c.reason,
        lines: c.lines,
      },
    });
    await audit(tx, {
      actor: a.actor,
      companyId: a.companyId,
      partnershipId: m.partnershipId,
      action: "movement.counter_proposed",
      entityType: "Movement",
      entityId: m.id,
      data: { correctionId: corr.id, reason: c.reason, lines: c.lines },
    });
    return corr;
  });
  await safely(() => notifyDispute(m.id, corr.id, otherSide(a.side)));
  return corr;
}

/** Ztrátu, poškození a úpravu salda potvrzuje / rozporuje / ruší jen admin nebo logistik. */
function assertSpecialAllowed(ctx: Ctx, m: MovementFull) {
  if (!BASIC_KINDS.includes(m.kind)) assertCan(ctx.role, "movements.createSpecial");
}

export async function confirmMovement(ctx: Ctx, id: string) {
  assertCan(ctx.role, "movements.confirm");
  const m = await loadScoped(ctx, id);
  assertSpecialAllowed(ctx, m);
  await doConfirm(m, actingFromCtx(ctx, m));
}

export async function disputeMovement(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.role, "movements.dispute");
  const m = await loadScoped(ctx, id);
  assertSpecialAllowed(ctx, m);
  return doDispute(m, actingFromCtx(ctx, m), input);
}

export async function acceptCorrection(ctx: Ctx, id: string) {
  assertCan(ctx.role, "disputes.resolve");
  const m = await loadScoped(ctx, id);
  await doAccept(m, actingFromCtx(ctx, m));
}

export async function counterCorrection(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.role, "disputes.resolve");
  const m = await loadScoped(ctx, id);
  return doCounter(m, actingFromCtx(ctx, m), input);
}

export async function cancelMovement(ctx: Ctx, id: string) {
  assertCan(ctx.role, "movements.create");
  const m = await loadScoped(ctx, id);
  assertSpecialAllowed(ctx, m);
  const a = actingFromCtx(ctx, m);
  if (m.createdBySide !== a.side) throw forbidden("Zrušit může jen firma, která pohyb zapsala.");
  if (m.status !== "PROPOSED") throw conflict("Zrušit lze jen pohyb, který ještě nebyl potvrzen ani rozporován.");
  await prisma.$transaction(async (tx) => {
    await setStatus(tx, m.id, "PROPOSED", { status: "CANCELLED" });
    await tx.partnerLinkToken.updateMany({ where: { movementId: m.id, usedAt: null }, data: { expiresAt: new Date() } });
    await audit(tx, {
      actor: a.actor,
      companyId: a.companyId,
      partnershipId: m.partnershipId,
      action: "movement.cancelled",
      entityType: "Movement",
      entityId: m.id,
    });
  });
}

// ---------------------------------------------------------------- jednorázové odkazy

export async function findPartnerLink(token: string) {
  if (!token) return null;
  const link = await prisma.partnerLinkToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.usedAt || link.expiresAt < new Date()) return null;
  const m = await prisma.movement.findUnique({ where: { id: link.movementId }, include: movementInclude });
  if (!m || m.partnership.companyBId) return null; // registrovaný partner potvrzuje v aplikaci
  // neregistrovaný partner je vždy strana B – pohled počítáme z jeho strany. Jednající přes odkaz smí
  // potvrdit, rozporovat i řešit rozpor (role se ho netýká) → pro výpočet `can` plná oprávnění.
  return { link, movement: m, view: toMovementView(m, null, "ADMIN", "B") };
}

/**
 * Akce přes jednorázový odkaz. Neregistrovaný partner je vždy strana B.
 * Odkaz se po použití zneplatní.
 */
export async function actOnPartnerLink(
  token: string,
  action: "confirm" | "dispute" | "accept" | "counter",
  input: { name: string; reason?: string; lines?: { packagingTypeId: string; quantity: number }[] },
) {
  const found = await findPartnerLink(token);
  if (!found) throw invalid("Odkaz je neplatný, vypršel, nebo už byl použit.");
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw invalid("Zadejte své jméno.");
  const a: Acting = { side: "B", actor: { label: `${name.slice(0, 100)} (${found.movement.partnership.invitedEmail})` }, companyId: null, role: null };
  const claimed = await prisma.partnerLinkToken.updateMany({
    where: { id: found.link.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw invalid("Odkaz už byl použit.");
  try {
    if (action === "confirm") await doConfirm(found.movement, a);
    else if (action === "dispute") await doDispute(found.movement, a, input);
    else if (action === "accept") await doAccept(found.movement, a);
    else await doCounter(found.movement, a, input);
  } catch (e) {
    // akce neproběhla → odkaz vrátíme do platnosti
    await prisma.partnerLinkToken.update({ where: { id: found.link.id }, data: { usedAt: null } });
    throw e;
  }
}

// ---------------------------------------------------------------- upozornění na rozpor

async function notifyDispute(movementId: string, correctionId: string, toSide: Side) {
  const m = await prisma.movement.findUniqueOrThrow({
    where: { id: movementId },
    include: { partnership: { include: { companyA: true, companyB: true } } },
  });
  const p = m.partnership;
  if (toSide === "B" && !p.companyBId) {
    // neregistrovaný partner – nový jednorázový odkaz
    await sendPartnerLink(m.id);
    return;
  }
  const fromName = toSide === "A" ? (p.companyB?.name ?? p.invitedName) : p.companyA.name;
  const emails = await notifyEmailsForSide(p, toSide);
  for (const to of emails) {
    const key = `dispute:${correctionId}:${to}`;
    const exists = await prisma.notificationLog.findUnique({ where: { key } });
    if (exists) continue;
    await sendEmail({
      to,
      subject: `Rozpor u pohybu ${formatMovementNumber(m.number)} (${fromName})`,
      text:
        `${fromName} nesouhlasí s pohybem ${formatMovementNumber(m.number)} a navrhuje opravu.\n` +
        `Detail a vyřešení: ${appUrl(`/movements/${m.id}`)}\n\n` +
        `---\n${fromName} disputed movement ${formatMovementNumber(m.number)}. Details: ${appUrl(`/movements/${m.id}`)}`,
    });
    await prisma.notificationLog.create({
      data: { key, kind: "dispute", sentTo: to, companyId: toSide === "A" ? p.companyAId : p.companyBId },
    });
  }
}
