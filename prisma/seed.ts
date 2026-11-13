/**
 * Ukázková data ObalBook (všechny firmy, osoby a adresy jsou SMYŠLENÉ).
 * 3 firmy, 5 typů obalů, 300 pohybů za posledních 6 měsíců včetně rozporů.
 *
 * Spuštění: npm run db:seed   (data se zapisují přes stejné služby jako v aplikaci, takže vzniká i auditní stopa)
 */
import type { MovementKind } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { Ctx } from "../src/lib/context";
import * as partners from "../src/lib/services/partners";
import * as packaging from "../src/lib/services/packaging";
import * as mv from "../src/lib/services/movements";
import { createCompanyForUser } from "../src/lib/services/companies";

export const SEED_USERS = {
  pivovar: { admin: "admin@zlatyjecmen.example", logistik: "logistika@zlatyjecmen.example", sklad: "sklad@zlatyjecmen.example" },
  velkoobchod: { admin: "admin@moravanapoje.example", logistik: "logistika@moravanapoje.example", sklad: "sklad@moravanapoje.example" },
  hurtownia: { admin: "admin@wisla-hurt.example", logistik: "logistyka@wisla-hurt.example", sklad: "magazyn@wisla-hurt.example" },
} as const;
export const SEED_UNREGISTERED = "objednavky@ulipy.example";

/** Deterministický generátor (stejná data při každém spuštění). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function makeUser(email: string, name: string) {
  return prisma.user.create({ data: { email, name, emailVerified: new Date(), locale: email.endsWith("wisla-hurt.example") ? "en" : "cs" } });
}

async function company(emails: { admin: string; logistik: string; sklad: string }, data: { name: string; regNumber: string; country: string; address: string }, names: [string, string, string]) {
  const admin = await makeUser(emails.admin, names[0]);
  const c = await createCompanyForUser(admin.id, data);
  const logistik = await prisma.user.create({ data: { email: emails.logistik, name: names[1], companyId: c.id, role: "LOGISTIK", emailVerified: new Date() } });
  const sklad = await prisma.user.create({ data: { email: emails.sklad, name: names[2], companyId: c.id, role: "SKLAD", emailVerified: new Date() } });
  const ctx = (u: { id: string; email: string; name: string | null }, role: Ctx["role"]): Ctx => ({ userId: u.id, companyId: c.id, role, email: u.email, name: u.name });
  return { company: c, admin: ctx(admin, "ADMIN"), logistik: ctx(logistik, "LOGISTIK"), sklad: ctx(sklad, "SKLAD") };
}

export async function seed(opts: { movements?: number; now?: Date } = {}) {
  const total = opts.movements ?? 300;
  const now = opts.now ?? new Date();
  if (await prisma.user.findUnique({ where: { email: SEED_USERS.pivovar.admin } })) {
    console.log("Ukázková data už v databázi jsou – nic nedělám.");
    return null;
  }
  process.env.EMAIL_SILENT = "1";

  const piv = await company(
    SEED_USERS.pivovar,
    { name: "Pivovar Zlatý Ječmen s.r.o.", regNumber: "99000001", country: "CZ", address: "Sladovnická 12, 500 00 Hradec Králové" },
    ["Petra Sládková", "Tomáš Vozka", "Karel Rampa"],
  );
  const vel = await company(
    SEED_USERS.velkoobchod,
    { name: "Nápojový velkoobchod Morava a.s.", regNumber: "99000002", country: "CZ", address: "Skladová 3, 602 00 Brno" },
    ["Jana Obchodní", "Martin Expedice", "Lukáš Paleta"],
  );
  const hur = await company(
    SEED_USERS.hurtownia,
    { name: "Hurtownia Napojów Wisła sp. z o.o.", regNumber: "PL9900000003", country: "PL", address: "ul. Magazynowa 7, 30-001 Kraków" },
    ["Anna Nowak", "Piotr Logistyk", "Marek Magazyn"],
  );
  await prisma.company.update({ where: { id: piv.company.id }, data: { balanceAlertLimit: 400 } });

  // typy obalů (5): 4 vlastní pivovar (z toho 1 nevratný), 1 velkoobchod
  const eur = await packaging.createPackagingType(piv.logistik, { name: "EUR paleta", code: "EUR", material: "dřevo", weightKg: 25, deposit: 350, currency: "CZK", reusable: true });
  const box = await packaging.createPackagingType(piv.logistik, { name: "Přepravka 20 × 0,5 l", code: "BOX20", material: "plast", weightKg: 1.8, deposit: 100, currency: "CZK", reusable: true });
  const keg = await packaging.createPackagingType(piv.logistik, { name: "Sud KEG 50 l", code: "KEG50", material: "nerez ocel", weightKg: 12.5, deposit: 1500, currency: "CZK", reusable: true });
  const krt = await packaging.createPackagingType(piv.logistik, { name: "Karton 6 × 0,5 l (nevratný)", code: "KRT6", material: "karton", weightKg: 0.3, reusable: false });
  const h1 = await packaging.createPackagingType(vel.logistik, { name: "Plastová paleta H1", code: "H1", material: "plast", weightKg: 18, deposit: 25, currency: "EUR", reusable: true });

  // partnerství: pivovar ↔ velkoobchod, pivovar ↔ hurtownia, velkoobchod ↔ hurtownia, + neregistrovaná restaurace
  async function connect(a: Ctx, b: Ctx, name: string, code: string) {
    const { url, partnership } = await partners.invitePartner(a, { name, email: b.email, code });
    await partners.acceptPartnerInvite(b, url.split("/partner-invite/")[1]);
    return partnership.id;
  }
  const pPV = await connect(piv.admin, vel.admin, "Nápojový velkoobchod Morava", "MORAVA");
  const pPH = await connect(piv.admin, hur.admin, "Hurtownia Wisła", "WISLA");
  const pVH = await connect(vel.admin, hur.admin, "Hurtownia Wisła", "WISLA");
  const pPU = (await partners.invitePartner(piv.logistik, { name: "Restaurace U Lípy", email: SEED_UNREGISTERED, code: "ULIPY" })).partnership.id;

  type Route = { p: string; from: typeof piv; to: typeof piv | null; types: { id: string; q: [number, number] }[]; weight: number };
  const routes: Route[] = [
    { p: pPV, from: piv, to: vel, types: [{ id: eur.id, q: [10, 33] }, { id: box.id, q: [40, 200] }, { id: keg.id, q: [5, 30] }, { id: krt.id, q: [50, 400] }], weight: 0.45 },
    { p: pPH, from: piv, to: hur, types: [{ id: eur.id, q: [15, 33] }, { id: keg.id, q: [10, 40] }, { id: krt.id, q: [100, 600] }], weight: 0.25 },
    { p: pVH, from: vel, to: hur, types: [{ id: h1.id, q: [5, 26] }], weight: 0.2 },
    { p: pPU, from: piv, to: null, types: [{ id: keg.id, q: [2, 8] }, { id: box.id, q: [5, 20] }], weight: 0.1 },
  ];
  const r = rng(20261112);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const DAY = 24 * 3600 * 1000;
  const start = now.getTime() - 182 * DAY;

  const types = [eur, box, keg, krt, h1];
  const outstanding = new Map<string, number>();
  const stats = { created: 0, confirmed: 0, disputedResolved: 0, disputedOpen: 0, proposed: 0, cancelled: 0 };
  for (let i = 0; i < total; i++) {
    // datumy rovnoměrně přes 6 měsíců, vzestupně
    const date = new Date(start + Math.floor(((i + r()) / total) * 180 * DAY));
    const dateStr = date.toISOString().slice(0, 10);
    const x = r();
    let acc = 0;
    const route = routes.find((rt) => (acc += rt.weight) >= x) ?? routes[0];
    const owner = route.from;
    const partnerSide = route.to;

    // druh: převážně výdej s obaly → vrácení prázdných, občas příjem, ztráta, poškození, úprava
    const k = r();
    let kind: MovementKind = "ISSUE";
    let actor: Ctx = pick([owner.sklad, owner.logistik]);
    let direction: "IN" | "OUT" | undefined;
    let typeChoices = route.types;
    if (k < 0.5) kind = "ISSUE";
    else if (k < 0.85) {
      kind = "RETURN"; // partner vrací prázdné obaly
      typeChoices = route.types.filter((t) => t.id !== krt.id);
      if (partnerSide && r() < 0.6) {
        actor = pick([partnerSide.sklad, partnerSide.logistik]);
        direction = "OUT";
      } else direction = "IN";
    } else if (k < 0.92) {
      kind = "RECEIPT"; // obaly zpět spolu s vratným zbožím
      typeChoices = route.types.filter((t) => t.id !== krt.id);
    } else if (k < 0.96) {
      kind = "DAMAGE";
      actor = owner.logistik;
      direction = "IN";
      typeChoices = route.types.filter((t) => t.id !== krt.id);
    } else if (k < 0.98) {
      kind = "LOSS";
      actor = owner.logistik;
      direction = "IN";
      typeChoices = route.types.filter((t) => t.id !== krt.id);
    } else {
      kind = "CORRECTION";
      actor = owner.admin;
      direction = r() < 0.5 ? "OUT" : "IN";
      typeChoices = route.types.filter((t) => t.id !== krt.id);
    }
    const nLines = Math.min(typeChoices.length, kind === "ISSUE" ? between(1, 3) : 1);
    const chosen = [...typeChoices].sort(() => r() - 0.5).slice(0, nLines);
    // vratky a příjmy vracejí část toho, co je u partnera – saldo zůstává realistické
    const lines = chosen
      .map((t) => {
        const [a, b] = t.q;
        const key = `${route.p}|${t.id}`;
        const outNow = outstanding.get(key) ?? 0;
        let q: number;
        if (kind === "ISSUE") q = between(a, b);
        else if (kind === "RETURN" || kind === "RECEIPT") q = Math.max(1, Math.round(outNow * (0.3 + r() * 0.4)));
        else q = between(1, 4);
        return { packagingTypeId: t.id, quantity: q };
      })
      .filter((l) => l.quantity > 0);
    for (const l of lines) {
      const key = `${route.p}|${l.packagingTypeId}`;
      const t = types.find((x) => x.id === l.packagingTypeId);
      if (!t?.reusable) continue;
      const sign = kind === "ISSUE" || (kind === "CORRECTION" && direction === "OUT") ? 1 : -1;
      outstanding.set(key, Math.max(0, (outstanding.get(key) ?? 0) + sign * l.quantity));
    }
    const m = await mv.createMovement(actor, {
      partnershipId: route.p,
      kind,
      direction,
      date: dateStr,
      deliveryNote: kind === "ISSUE" || kind === "RECEIPT" ? `DL${dateStr.replace(/-/g, "").slice(2)}-${String(i + 1).padStart(3, "0")}` : undefined,
      note: kind === "DAMAGE" ? "Rozbité při vykládce" : kind === "LOSS" ? "Nedohledáno při inventuře" : undefined,
    lines,
    });
    stats.created++;

    // kdo potvrzuje: druhá strana (u neregistrované restaurace necháme část nepotvrzenou)
    const creatorCompany = actor.companyId;
    const other = [owner, partnerSide].find((c) => c && c.company.id !== creatorCompany) ?? null;
    const age = (now.getTime() - date.getTime()) / DAY;
    const fate = r();
    const createdAt = new Date(date.getTime() + between(7, 16) * 3600 * 1000);
    await prisma.movement.update({ where: { id: m.id }, data: { createdAt } });

    if (!other) {
      // neregistrovaný partner: starší pohyby potvrzené přes odkaz, nejnovější čekají
      if (age > 10) {
        const link = await prisma.partnerLinkToken.findFirst({ where: { movementId: m.id } });
        if (link) {
          await prisma.movement.update({ where: { id: m.id }, data: { status: "CONFIRMED", confirmedAt: new Date(createdAt.getTime() + DAY), confirmedByLabel: `Jiří Lípa (${SEED_UNREGISTERED})` } });
          for (const l of await prisma.movementLine.findMany({ where: { movementId: m.id } })) await prisma.movementLine.update({ where: { id: l.id }, data: { finalQuantity: l.quantity } });
          await prisma.partnerLinkToken.update({ where: { id: link.id }, data: { usedAt: new Date(createdAt.getTime() + DAY) } });
          await prisma.auditLog.create({ data: { partnershipId: route.p, actorLabel: `Jiří Lípa (${SEED_UNREGISTERED})`, action: "movement.confirmed", entityType: "Movement", entityId: m.id, createdAt: new Date(createdAt.getTime() + DAY) } });
          stats.confirmed++;
        }
      } else stats.proposed++;
      continue;
    }
    const confirmer = BASIC.includes(kind) ? pick([other.sklad, other.logistik]) : other.logistik;
    const isIssue = kind === "ISSUE";
    if (age < 12 && fate < 0.7) {
      stats.proposed++; // čerstvé – čeká na potvrzení
    } else if (isIssue && fate < 0.07) {
      // rozpor vyřešený dohodou
      const corrected = lines.map((l) => ({ packagingTypeId: l.packagingTypeId, quantity: Math.max(0, l.quantity - between(1, 3)) }));
      await mv.disputeMovement(confirmer, m.id, { reason: pick(["Při příjmu chyběly kusy", "Část obalů vrácena řidiči", "Přepočítáno na skladě – méně kusů"]), lines: corrected });
      const creatorSide = creatorCompany === owner.company.id ? owner : other;
      if (r() < 0.5) {
        const middle = lines.map((l, j) => ({ packagingTypeId: l.packagingTypeId, quantity: Math.round((l.quantity + corrected[j].quantity) / 2) }));
        if (middle.some((x, j) => x.quantity !== corrected[j].quantity)) {
          await mv.counterCorrection(creatorSide.logistik, m.id, { reason: "Podle nakládacího listu – navrhujeme kompromis", lines: middle });
          await mv.acceptCorrection(other.company.id === creatorCompany ? owner.logistik : other.logistik, m.id);
        } else await mv.acceptCorrection(creatorSide.logistik, m.id);
      } else {
        await mv.acceptCorrection(creatorSide.logistik, m.id);
      }
      stats.disputedResolved++;
    } else if (isIssue && fate < 0.12 && age < 75) {
      // otevřený rozpor (čeká na vyřešení)
      const corrected = lines.map((l) => ({ packagingTypeId: l.packagingTypeId, quantity: Math.max(0, l.quantity - between(1, 5)) }));
      await mv.disputeMovement(confirmer, m.id, { reason: "Dorazilo méně kusů, než je na dodacím listu", lines: corrected });
      stats.disputedOpen++;
    } else if (fate > 0.985) {
      await mv.cancelMovement(actor, m.id); // zapsáno omylem
      stats.cancelled++;
    } else {
      await mv.confirmMovement(confirmer, m.id);
      stats.confirmed++;
    }
    // generátor: do odhadu „u partnera“ počítat jen potvrzené pohyby (jinak by vratky přestřelily)
    const final = await prisma.movement.findUniqueOrThrow({ where: { id: m.id }, include: { lines: true } });
    for (const l of final.lines) {
      const key = `${route.p}|${l.packagingTypeId}`;
      if (!types.find((x) => x.id === l.packagingTypeId)?.reusable) continue;
      const sign = kind === "ISSUE" || (kind === "CORRECTION" && direction === "OUT") ? 1 : -1;
      const counted = l.quantity;
      const real = final.status === "CONFIRMED" ? (l.finalQuantity ?? l.quantity) : 0;
      outstanding.set(key, Math.max(0, (outstanding.get(key) ?? 0) + sign * (real - counted)));
    }
    // časy potvrzení a auditu posunout k datu pohybu (realistická historie)
    const later = new Date(createdAt.getTime() + between(2, 40) * 3600 * 1000);
    await prisma.movement.updateMany({ where: { id: m.id, confirmedAt: { not: null } }, data: { confirmedAt: later } });
    await prisma.auditLog.updateMany({ where: { entityId: m.id, action: "movement.created" }, data: { createdAt } });
    await prisma.auditLog.updateMany({ where: { entityId: m.id, action: { not: "movement.created" } }, data: { createdAt: later } });
    await prisma.movementCorrection.updateMany({ where: { movementId: m.id }, data: { createdAt: later } });
  }
  // ukázková data nemají spouštět e-maily z minulosti: staré e-maily z dev schránky pryč
  await prisma.devEmail.deleteMany({});
  return { stats, companies: [piv.company.name, vel.company.name, hur.company.name] };
}

const BASIC: MovementKind[] = ["ISSUE", "RECEIPT", "RETURN"];

if (require.main === module) {
  seed()
    .then((r) => {
      if (r) {
        console.log("Ukázková data vytvořena:", r.stats);
        console.log("Přihlaste se (magic link se vypíše do konzole `npm run dev`):");
        for (const [k, v] of Object.entries(SEED_USERS)) console.log(`  ${k}: ${v.admin} | ${v.logistik} | ${v.sklad}`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
