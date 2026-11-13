import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { conflict, invalid, notFound } from "../errors";
import { parse } from "./validate";
import { getPartnershipRaw } from "./partners";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), schema.optional());

export const packagingSchema = z.object({
  name: z.string().trim().min(2, "Zadejte název obalu.").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_.-]{1,20}$/, "Kód smí obsahovat jen písmena A–Z, číslice, tečku, - a _ (max. 20 znaků)."),
  material: z.preprocess((v) => (v === null || v === "" ? undefined : v), z.string().trim().max(60).optional()),
  weightKg: z.coerce
    .number({ invalid_type_error: "Hmotnost musí být číslo." })
    .positive("Hmotnost musí být větší než 0 (potřebujeme ji pro výkaz PPWR).")
    .max(10000, "Hmotnost je příliš velká."),
  deposit: optionalNumber(z.coerce.number().min(0, "Kauce nesmí být záporná.").max(1_000_000)),
  currency: z.enum(["CZK", "EUR"]).default("CZK"),
  reusable: z.preprocess((v) => (v === undefined ? true : v === true || v === "true" || v === "on" || v === "1"), z.boolean()),
  active: z.preprocess((v) => (v === undefined ? true : v === true || v === "true" || v === "on"), z.boolean()).optional(),
  sharedWithPartners: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()).optional(),
});

/**
 * Které typy obalů smí firma `companyId` vidět a zapisovat v partnerství `p`:
 * vlastní typy + typy druhé strany, které vlastník nabízí všem partnerům, nebo které už v tomto
 * partnerství byly použity. Celý katalog druhé firmy (obaly pro jiné partnery, kauce) se neukazuje.
 */
export function usableTypesWhere(
  p: { id: string; companyAId: string; companyBId: string | null },
  companyId: string,
): Prisma.PackagingTypeWhereInput {
  const other = p.companyAId === companyId ? p.companyBId : p.companyAId;
  return {
    OR: [
      { companyId },
      ...(other
        ? [{ companyId: other, OR: [{ sharedWithPartners: true }, { lines: { some: { movement: { partnershipId: p.id } } } }] }]
        : []),
    ],
  };
}

export async function listPackagingTypes(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  return prisma.packagingType.findMany({
    where: { companyId: ctx.companyId, ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: { code: "asc" },
  });
}

export async function getPackagingType(ctx: Ctx, id: string) {
  const t = await prisma.packagingType.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!t) throw notFound("Typ obalu");
  return t;
}

/**
 * Typy obalů použitelné v pohybech s partnerem = vlastní typy obou stran partnerství.
 * (Partner vrací naše palety, my vracíme jeho přepravky.)
 */
export async function listTypesForPartnership(ctx: Ctx, partnershipId: string) {
  const p = await getPartnershipRaw(ctx, partnershipId);
  return prisma.packagingType.findMany({
    // aktivní typy + neaktivní, které už v tomto partnerství byly (aby šly vrátit)
    where: {
      AND: [
        usableTypesWhere(p, ctx.companyId),
        { OR: [{ active: true }, { lines: { some: { movement: { partnershipId: p.id } } } }] },
      ],
    },
    include: { company: { select: { id: true, name: true } } },
    orderBy: [{ companyId: "asc" }, { code: "asc" }],
  });
}

export async function createPackagingType(ctx: Ctx, input: unknown) {
  assertCan(ctx.role, "packaging.manage");
  const data = parse(packagingSchema, input);
  const clash = await prisma.packagingType.findFirst({ where: { companyId: ctx.companyId, code: data.code } });
  if (clash) throw conflict(`Kód ${data.code} už používáte.`);
  return prisma.$transaction(async (tx) => {
    const t = await tx.packagingType.create({
      data: { ...data, active: data.active ?? true, sharedWithPartners: data.sharedWithPartners ?? false, companyId: ctx.companyId },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "packaging.created",
      entityType: "PackagingType",
      entityId: t.id,
      data: { ...data },
    });
    return t;
  });
}

export async function updatePackagingType(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.role, "packaging.manage");
  const before = await getPackagingType(ctx, id);
  // nezadaná pole zůstávají beze změny (PATCH)
  const current = {
    name: before.name,
    code: before.code,
    material: before.material ?? undefined,
    weightKg: before.weightKg.toString(),
    deposit: before.deposit?.toString(),
    currency: before.currency,
    reusable: before.reusable,
    active: before.active,
    sharedWithPartners: before.sharedWithPartners,
  };
  // null = smazat hodnotu (kauce, materiál), undefined = beze změny
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    if (v === null) {
      if (k !== "material" && k !== "deposit") throw invalid(`Pole ${k} nelze smazat.`);
      delete merged[k];
    }
    else if (v !== undefined) merged[k] = v;
  }
  const data = parse(packagingSchema, merged);
  const clash = await prisma.packagingType.findFirst({
    where: { companyId: ctx.companyId, code: data.code, id: { not: id } },
  });
  if (clash) throw conflict(`Kód ${data.code} už používáte.`);
  return prisma.$transaction(async (tx) => {
    const t = await tx.packagingType.update({
      where: { id: before.id },
      data: {
        ...data,
        material: data.material ?? null,
        active: data.active ?? before.active,
        sharedWithPartners: data.sharedWithPartners ?? before.sharedWithPartners,
        deposit: data.deposit ?? null,
      },
    });
    await audit(tx, {
      actor: { userId: ctx.userId },
      companyId: ctx.companyId,
      action: "packaging.updated",
      entityType: "PackagingType",
      entityId: t.id,
      data: {
        before: {
          name: before.name,
          code: before.code,
          material: before.material,
          weightKg: before.weightKg.toString(),
          deposit: before.deposit?.toString() ?? null,
          currency: before.currency,
          reusable: before.reusable,
          active: before.active,
          sharedWithPartners: before.sharedWithPartners,
        },
        after: { ...data },
      },
    });
    return t;
  });
}
