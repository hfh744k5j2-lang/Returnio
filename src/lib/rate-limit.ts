import { headers } from "next/headers";
import { prisma } from "./db";
import { tooManyAttempts } from "./errors";

/**
 * Omezení počtu pokusů v pevném okně. Stav je v databázi (tabulka RateLimit), takže platí
 * napříč instancemi serveru (Vercel). Vrací true, pokud je pokus ještě v limitu.
 */
export async function hit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::int)
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::int)
                     THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  // občas uklidit staré záznamy (tabulka neroste donekonečna)
  if (Math.random() < 0.01) await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });
  return Number(rows[0]?.count ?? 0) <= limit;
}

/** Jako hit(), ale při překročení vyhodí chybu se srozumitelnou hláškou (HTTP 429). */
export async function enforce(key: string, limit: number, windowSec: number): Promise<void> {
  if (!(await hit(key, limit, windowSec))) throw tooManyAttempts();
}

/** IP adresa klienta (za proxy Vercelu první položka X-Forwarded-For). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

/** Limity – na jednom místě, aby šly snadno upravit. */
export const LIMITS = {
  magicLinkPerEmail: { limit: 5, windowSec: 15 * 60 },
  magicLinkPerIp: { limit: 20, windowSec: 15 * 60 },
  /** Pojistka přímo při odesílání e-mailu (i pro přímé volání /api/auth/signin/email mimo formulář). */
  magicLinkSendPerEmail: { limit: 6, windowSec: 15 * 60 },
  partnerLinkPerIp: { limit: 30, windowSec: 10 * 60 },
  partnerLinkPerToken: { limit: 10, windowSec: 10 * 60 },
} as const;
