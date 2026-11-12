import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server";
import { LangSwitch } from "@/components/LangSwitch";
import { SignOutButton } from "@/components/SignOutButton";
import { NavLinks } from "@/components/NavLinks";

const NAV: { href: string; key: string; perm?: Permission }[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/scan", key: "nav.scan", perm: "movements.create" },
  { href: "/movements", key: "nav.movements" },
  { href: "/balances", key: "nav.balances" },
  { href: "/partners", key: "nav.partners" },
  { href: "/packaging", key: "nav.packaging" },
  { href: "/import", key: "nav.import", perm: "import.run" },
  { href: "/reports/ppwr", key: "nav.ppwr", perm: "reports.view" },
  { href: "/audit", key: "nav.audit", perm: "audit.view" },
  { href: "/settings", key: "nav.settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const { t } = await getT();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { name: true } });
  const items = NAV.filter((n) => !n.perm || can(ctx.role, n.perm)).map((n) => ({ href: n.href, label: t(n.key) }));
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/dashboard" className="text-lg font-bold text-brand-700">ObalBook</Link>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-slate-600 sm:inline" data-testid="current-company">
              {company.name} · {t(`roles.${ctx.role}`)}
            </span>
            <LangSwitch />
            <SignOutButton label={t("nav.signOut")} />
          </div>
        </div>
        <NavLinks items={items} label={t("nav.menu")} />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
