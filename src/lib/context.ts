import type { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { safeNext } from "./safe-next";
import { auth } from "./auth";
import { prisma } from "./db";
import { AppError } from "./errors";

/** Kontext přihlášeného uživatele. Všechny služby dostávají ctx a podle něj omezují dotazy. */
export type Ctx = { userId: string; companyId: string; role: Role; email: string; name: string | null };

export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id }, include: { company: true } });
}

export async function getCtx(): Promise<Ctx | null> {
  const user = await currentUser();
  if (!user || !user.companyId || !user.role) return null;
  return { userId: user.id, companyId: user.companyId, role: user.role, email: user.email, name: user.name };
}

/** Pro stránky: nepřihlášený → /login, bez firmy → /onboarding. */
export async function requireCtx(): Promise<Ctx> {
  const user = await currentUser();
  if (!user) {
    const next = safeNext((await headers()).get("x-pathname"), "");
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  if (!user.companyId || !user.role) redirect("/onboarding");
  return { userId: user.id, companyId: user.companyId, role: user.role, email: user.email, name: user.name };
}

/** Pro API: vyhodí 401. */
export async function requireApiCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AppError("UNAUTHORIZED", "Nepřihlášen.");
  return ctx;
}
