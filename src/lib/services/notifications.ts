import type { Side } from "@prisma/client";
import { prisma } from "../db";
import type { Ctx } from "../context";
import { appUrl } from "../tokens";
import { sendEmail } from "../email";
import { formatMovementNumber, safely, sendPartnerLink } from "./movements";
import { notifyEmailsForSide, otherSide } from "./partners";
import { getBalances, totalAbsByPartner } from "./balance";

export const STALE_DAYS = 3;

/** Nejdřív zápis (unikátní klíč), pak odeslání – souběžné spuštění cronu nepošle e-mail dvakrát. */
async function once(key: string, data: { companyId: string | null; kind: string; sentTo: string }, send: () => Promise<unknown>) {
  try {
    await prisma.notificationLog.create({ data: { key, ...data } });
  } catch {
    return false; // už odesláno (nebo právě odesílá jiný běh)
  }
  try {
    await send();
    return true;
  } catch (e) {
    await prisma.notificationLog.delete({ where: { key } }).catch(() => undefined);
    throw e;
  }
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${w}`;
}

/**
 * Upozornění spouštěná cronem (1× denně):
 * 1) nepotvrzený pohyb starší 3 dnů → straně, která má jednat (souhrnný e-mail, každý pohyb jen jednou),
 * 2) saldo nad limitem firmy → adminům a logistikům té firmy (nejvýše 1× týdně za partnera).
 * (Nový rozpor se oznamuje hned při jeho vzniku.)
 * Každý e-mail jde jen uživatelům firmy, které se týká – nikdy třetí firmě.
 */
export async function runNotifications(now = new Date()) {
  const stats = { staleEmails: 0, staleLinks: 0, limitEmails: 0 };
  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 3600 * 1000);

  // 1) staré nepotvrzené pohyby
  // „starší 3 dnů“ = od poslední změny stavu: u navrženého od vzniku, u rozporu od otevřeného návrhu opravy
  const stale = await prisma.movement.findMany({
    where: {
      OR: [
        { status: "PROPOSED", createdAt: { lt: cutoff } },
        { status: "DISPUTED", corrections: { some: { status: "OPEN", createdAt: { lt: cutoff } } } },
      ],
    },
    include: { partnership: { include: { companyA: true, companyB: true } }, corrections: { where: { status: "OPEN" } } },
    orderBy: { createdAt: "asc" }, // nejstarší čekají nejdéle – mají přednost
    take: 2000,
  });
  const digest = new Map<string, { companyId: string | null; items: { key: string; line: string }[] }>();
  for (const m of stale) {
    // kdo má jednat: u navrženého protistrana autora, u rozporu strana, která nenavrhla otevřenou opravu
    const actSide: Side = m.status === "PROPOSED" ? otherSide(m.createdBySide) : otherSide(m.corrections[0]?.proposedBySide ?? m.createdBySide);
    const p = m.partnership;
    if (actSide === "B" && !p.companyBId) {
      // neregistrovaný partner: připomínka s novým jednorázovým odkazem (jednou)
      const sent = await once(`stale-link:${m.id}:${m.corrections[0]?.id ?? "proposed"}`, { companyId: null, kind: "stale", sentTo: p.invitedEmail }, async () => {
        await sendPartnerLink(m.id);
      }).catch(() => false);
      if (sent) stats.staleLinks++;
      continue;
    }
    const companyId = actSide === "A" ? p.companyAId : p.companyBId!;
    const otherName = actSide === "A" ? (p.companyB?.name ?? p.invitedName) : p.companyA.name;
    for (const email of await notifyEmailsForSide(p, actSide)) {
      // klíč podle „tahu“ – když se pohyb po protinávrhu vrátí ke stejné straně, připomene se znovu
      const key = `stale:${m.id}:${m.corrections[0]?.id ?? "proposed"}:${email}`;
      if (await prisma.notificationLog.findUnique({ where: { key } })) continue;
      const d = digest.get(email) ?? { companyId, items: [] };
      d.items.push({
        key,
        line: `- ${formatMovementNumber(m.number)} (${otherName}, ${m.date.toISOString().slice(0, 10)}, ${m.status === "DISPUTED" ? "rozpor" : "čeká na potvrzení"}): ${appUrl(`/movements/${m.id}`)}`,
      });
      digest.set(email, d);
    }
  }
  for (const [email, d] of digest) {
    await safely(async () => {
      const res = await prisma.notificationLog.createMany({
        data: d.items.map((i) => ({ key: i.key, companyId: d.companyId, kind: "stale", sentTo: email })),
        skipDuplicates: true,
      });
      if (res.count === 0) return; // souběžný běh už odeslal
      await sendEmail({
        to: email,
        subject: `ObalBook: pohyby čekající déle než ${STALE_DAYS} dny (${d.items.length})`,
        text:
          `Tyto pohyby obalů čekají na vaše potvrzení nebo vyřešení rozporu déle než ${STALE_DAYS} dny:\n\n` +
          d.items.map((i) => i.line).join("\n") +
          `\n\n---\nThese packaging movements have been waiting for your action for more than ${STALE_DAYS} days.`,
      }).catch(async (e) => {
        await prisma.notificationLog.deleteMany({ where: { key: { in: d.items.map((i) => i.key) } } });
        throw e;
      });
      stats.staleEmails++;
    });
  }

  // 2) saldo nad limitem
  const companies = await prisma.company.findMany({ where: { balanceAlertLimit: { not: null } } });
  for (const c of companies) {
    const ctx: Ctx = { userId: "system", companyId: c.id, role: "ADMIN", email: "", name: null };
    const { rows, partners } = await getBalances(ctx);
    const totals = totalAbsByPartner(rows);
    const recipients = await prisma.user.findMany({ where: { companyId: c.id, role: { in: ["ADMIN", "LOGISTIK"] } } });
    for (const [pid, total] of totals) {
      if (total <= (c.balanceAlertLimit ?? Infinity)) continue;
      const partner = partners.find((p) => p.id === pid)!;
      const detail = rows
        .filter((r) => r.partnershipId === pid && r.confirmed !== 0)
        .map((r) => `- ${r.typeName} (${r.typeCode}): ${r.confirmed > 0 ? `partner nám dluží ${r.confirmed} ks` : `dlužíme partnerovi ${-r.confirmed} ks`}`)
        .join("\n");
      for (const u of recipients) {
        await safely(async () => {
          const sent = await once(`limit:${c.id}:${pid}:${isoWeek(now)}:${u.email}`, { companyId: c.id, kind: "limit", sentTo: u.email }, () =>
            sendEmail({
              to: u.email,
              subject: `ObalBook: saldo s partnerem ${partner.name} přesáhlo limit`,
              text:
                `Saldo obalů s partnerem ${partner.name} přesáhlo váš limit ${c.balanceAlertLimit} ks (celkem ${total} ks všech typů):\n${detail}\n\n` +
                `Detail: ${appUrl(`/balances?partner=${pid}`)}\n\n---\nThe packaging balance with ${partner.name} exceeded your limit.`,
            }),
          );
          if (sent) stats.limitEmails++;
        });
      }
    }
  }
  return stats;
}
