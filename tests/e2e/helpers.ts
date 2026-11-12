import { randomBytes } from "crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";

export const db = new PrismaClient();

export function uniq(prefix: string) {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/** Vytvoří firmu s uživatelem dané role přímo v DB (rychlá příprava dat). */
export async function createCompanyWithUser(name: string, role: Role = "ADMIN", email?: string) {
  const company = await db.company.create({ data: { name } });
  const user = await db.user.create({
    data: { email: email ?? `${uniq("user")}@example.com`, companyId: company.id, role, emailVerified: new Date() },
  });
  return { company, user };
}

export async function addUser(companyId: string, role: Role) {
  return db.user.create({ data: { email: `${uniq(role.toLowerCase())}@example.com`, companyId, role } });
}

/** Přihlášení bez e-mailu: vytvoří databázovou session a nastaví cookie Auth.js. */
export async function loginAs(context: BrowserContext, userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { sessionToken, userId, expires: new Date(Date.now() + 24 * 3600 * 1000) } });
  await context.addCookies([
    { name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return sessionToken;
}

/** Poslední e-mail pro adresu z dev schránky. */
export async function lastEmail(to: string) {
  for (let i = 0; i < 20; i++) {
    const m = await db.devEmail.findFirst({ where: { to }, orderBy: { createdAt: "desc" } });
    if (m) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Žádný e-mail pro ${to}`);
}

export function linkFrom(text: string, pathPart: string) {
  const m = text.match(new RegExp(`https?://\\S*${pathPart}\\S*`));
  if (!m) throw new Error(`Odkaz ${pathPart} nenalezen v: ${text}`);
  return m[0];
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

export async function createPackaging(companyId: string, code: string, opts: { reusable?: boolean; weightKg?: number; name?: string } = {}) {
  return db.packagingType.create({
    data: { companyId, code, name: opts.name ?? `Obal ${code}`, weightKg: opts.weightKg ?? 25, reusable: opts.reusable ?? true },
  });
}

export async function createPartnership(companyAId: string, companyBId: string | null, opts: { name?: string; email?: string; code?: string } = {}) {
  return db.partnership.create({
    data: {
      companyAId,
      companyBId,
      invitedName: opts.name ?? "Partner",
      invitedEmail: opts.email ?? `${uniq("partner")}@example.com`,
      code: opts.code ?? uniq("P").toUpperCase().replace(/-/g, "").slice(0, 10),
      status: companyBId ? "ACTIVE" : "PENDING",
      codeB: companyBId ? uniq("Q").toUpperCase().replace(/-/g, "").slice(0, 10) : null,
    },
  });
}
