import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getBalances } from "@/lib/services/balance";
import { listPartners } from "@/lib/services/partners";
import { getT } from "@/lib/i18n/server";
import { formatNumber, todayLocal } from "@/lib/format";
import { BalanceCell } from "@/components/BalanceText";

export default async function BalancesPage({ searchParams }: { searchParams: Promise<{ partner?: string; asOf?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  const asOfDate = sp.asOf && !Number.isNaN(new Date(sp.asOf).getTime()) ? new Date(sp.asOf) : undefined;
  const partners = await listPartners(ctx);
  const partnerId = partners.some((p) => p.id === sp.partner) ? sp.partner : undefined;
  const { rows } = await getBalances(ctx, { partnershipId: partnerId, asOf: asOfDate });
  const byPartner = new Map<string, typeof rows>();
  for (const r of rows) byPartner.set(r.partnershipId, [...(byPartner.get(r.partnershipId) ?? []), r]);
  const exportQs = new URLSearchParams(Object.entries({ partner: partnerId, asOf: sp.asOf }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">{t("balances.title")}</h1>
        {can(ctx.role, "export.run") && <a className="btn-secondary" href={`/api/v1/export/balances?${exportQs}`}>{t("balances.exportCsv")}</a>}
      </div>
      <p className="muted">{t("balances.intro")}</p>
      {asOfDate && <p className="alert-warn">{t("balances.asOfNote")}</p>}
      <form method="get" className="card grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="b-partner">{t("common.partner")}</label>
          <select id="b-partner" name="partner" defaultValue={partnerId ?? ""} className="input">
            <option value="">{t("movements.allPartners")}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="b-asof">{t("balances.asOf")}</label>
          <input id="b-asof" type="date" name="asOf" defaultValue={sp.asOf ?? ""} max={todayLocal()} className="input" />
        </div>
        <button className="btn-secondary">{t("common.filter")}</button>
      </form>

      {rows.length === 0 ? (
        <p className="card muted">{t("balances.empty")}</p>
      ) : (
        [...byPartner.entries()].map(([pid, list]) => (
          <section key={pid} className="card overflow-x-auto" data-testid="balance-partner">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="h2">{list[0].partnerName}</h2>
              <Link className="text-sm text-brand-700 underline" href={`/movements?partner=${pid}`}>{t("partners.movements")}</Link>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("packaging.type")}</th>
                  <th>{t("balances.confirmed")}</th>
                  <th className="text-right">{t("balances.number")}</th>
                  {!asOfDate && <th className="text-right">{t("balances.pending")}</th>}
                  <th className="text-right">{t("balances.depositValue")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.packagingTypeId} data-type={r.typeCode}>
                    <td>{r.typeName} <span className="font-mono text-xs text-slate-500">{r.typeCode}</span><span className="block text-xs text-slate-500">{t("movementForm.owner", { owner: r.ownerName })}</span></td>
                    <td><BalanceCell t={t} n={r.confirmed} /></td>
                    <td className="text-right font-semibold tabular-nums">{r.confirmed}</td>
                    {!asOfDate && <td className="text-right tabular-nums text-slate-600">{r.pending ? t("balances.pendingChange", { n: r.pending > 0 ? `+${r.pending}` : r.pending }) : "–"}</td>}
                    <td className="text-right tabular-nums">{r.deposit ? `${formatNumber(r.confirmed * r.deposit, locale, 2)} ${r.currency === "CZK" ? "Kč" : "EUR"}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      <p className="muted">{t("balances.signHelp")} {t("balances.pendingHelp")}</p>
    </div>
  );
}
