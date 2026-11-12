import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { movementCounters, listMovements } from "@/lib/services/movements";
import { getBalances } from "@/lib/services/balance";
import { listPartners } from "@/lib/services/partners";
import { listPackagingTypes } from "@/lib/services/packaging";
import { getT } from "@/lib/i18n/server";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { BalanceCell } from "@/components/BalanceText";

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  const [counters, recent, balances, partners, types] = await Promise.all([
    movementCounters(ctx),
    listMovements(ctx, { pageSize: 8 }),
    getBalances(ctx),
    listPartners(ctx),
    listPackagingTypes(ctx),
  ]);
  const tiles = [
    { label: t("dashboard.toConfirm"), value: counters.toConfirm, href: "/movements?awaiting=me", tone: "text-amber-700" },
    { label: t("dashboard.disputesForMe"), value: counters.disputesForMe, href: "/movements?awaiting=dispute", tone: "text-red-700" },
    { label: t("dashboard.waitingForPartner"), value: counters.waitingForPartner, href: "/movements?awaiting=partner", tone: "text-slate-700" },
  ];
  const showSetup = partners.length === 0 || types.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{t("dashboard.title")}</h1>
        <div className="flex gap-2">
          {can(ctx.role, "movements.create") && <Link href="/scan" className="btn-primary">{t("dashboard.scan")}</Link>}
          {can(ctx.role, "movements.create") && <Link href="/movements/new" className="btn-secondary">{t("dashboard.newMovement")}</Link>}
        </div>
      </div>

      {showSetup && (
        <div className="alert-warn">
          <p className="font-semibold">{t("dashboard.setupTitle")}</p>
          <ul className="mt-1 list-inside list-disc">
            {types.length === 0 && <li><Link className="underline" href="/packaging">{t("dashboard.setupTypes")}</Link></li>}
            {partners.length === 0 && <li><Link className="underline" href="/partners">{t("dashboard.setupPartners")}</Link></li>}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((x) => (
          <Link key={x.href} href={x.href} className="card block hover:border-brand-600">
            <div className={`text-3xl font-bold ${x.tone}`}>{x.value}</div>
            <div className="muted">{x.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h2">{t("dashboard.balanceByPartner")}</h2>
            <Link href="/balances" className="text-sm text-brand-700 underline">{t("common.detail")}</Link>
          </div>
          {balances.rows.length === 0 ? (
            <p className="muted">{t("balances.empty")}</p>
          ) : (
            <table className="table">
              <thead><tr><th>{t("common.partner")}</th><th>{t("packaging.type")}</th><th>{t("balances.confirmed")}</th></tr></thead>
              <tbody>
                {balances.rows.slice(0, 12).map((r) => (
                  <tr key={r.partnershipId + r.packagingTypeId}>
                    <td><Link className="hover:underline" href={`/balances?partner=${r.partnershipId}`}>{r.partnerName}</Link></td>
                    <td>{r.typeName}<span className="block text-xs text-slate-500">{t("movementForm.owner", { owner: r.ownerName })}</span></td>
                    <td>
                      <BalanceCell t={t} n={r.confirmed} />
                      {r.pending !== 0 && <span className="block text-xs text-slate-500">{t("balances.pendingShort", { n: r.pending > 0 ? `+${r.pending}` : r.pending })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {balances.rows.length > 12 && <Link href="/balances" className="mt-2 inline-block text-sm text-brand-700 underline">{t("dashboard.moreRows", { n: balances.rows.length - 12 })}</Link>}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h2">{t("dashboard.recent")}</h2>
            <Link href="/movements" className="text-sm text-brand-700 underline">{t("common.all")}</Link>
          </div>
          {recent.items.length === 0 ? (
            <p className="muted">{t("movements.empty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.items.map((m) => (
                <li key={m.id}>
                  <Link href={`/movements/${m.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="font-medium">{t(`kinds.${m.kind}`)}</span> · {m.partnerName}
                      <span className="block text-xs text-slate-500">{m.numberLabel} · {formatDate(m.date, locale)}</span>
                    </span>
                    <StatusBadge status={m.status} t={t} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
