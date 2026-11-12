import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { ppwrReport } from "@/lib/services/reports";
import { getT } from "@/lib/i18n/server";
import { formatNumber, todayLocal } from "@/lib/format";
import { NoAccess } from "@/components/NoAccess";

function parseDay(v: string | undefined, fallback: string) {
  const s = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
  return { s, d: new Date(`${s}T00:00:00Z`) };
}

export default async function PpwrPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  if (!can(ctx.role, "reports.view")) return <NoAccess t={t} />;
  const today = todayLocal();
  const from = parseDay(sp.from, `${today.slice(0, 4)}-01-01`);
  const to = parseDay(sp.to, today);
  const valid = !Number.isNaN(from.d.getTime()) && !Number.isNaN(to.d.getTime()) && from.d <= to.d;
  const r = valid ? await ppwrReport(ctx, from.d, to.d) : null;
  const pct = (x: number | null) => (x === null ? "–" : `${formatNumber(x * 100, locale, 1)} %`);
  const year = Number(today.slice(0, 4));

  return (
    <div className="space-y-4">
      <h1 className="h1">{t("ppwr.title")}</h1>
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950" role="note" data-testid="ppwr-warning">
        <p className="text-lg font-bold">⚠ {t("ppwr.warningTitle")}</p>
        <p className="mt-1 text-sm">{t("ppwr.warningText")}</p>
      </div>

      <form method="get" className="card grid gap-3 sm:grid-cols-[12rem_12rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="pp-from">{t("movements.from")}</label>
          <input id="pp-from" type="date" name="from" defaultValue={from.s} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="pp-to">{t("movements.to")}</label>
          <input id="pp-to" type="date" name="to" defaultValue={to.s} max={today} className="input" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary">{t("ppwr.calculate")}</button>
          <a className="btn-secondary" href={`?from=${year - 1}-01-01&to=${year - 1}-12-31`}>{t("ppwr.lastYear", { year: year - 1 })}</a>
        </div>
      </form>

      {!r ? (
        <p className="alert-error">{t("ppwr.invalidPeriod")}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card"><div className="muted">{t("ppwr.sharePieces")}</div><div className="text-3xl font-bold text-brand-700" data-testid="share-pieces">{pct(r.reusableSharePieces)}</div><div className="muted">{t("ppwr.ofPieces", { a: formatNumber(r.reusablePieces, locale), b: formatNumber(r.totalPieces, locale) })}</div></div>
            <div className="card"><div className="muted">{t("ppwr.shareWeight")}</div><div className="text-3xl font-bold text-brand-700" data-testid="share-weight">{pct(r.reusableShareWeight)}</div><div className="muted">{t("ppwr.ofKg", { a: formatNumber(r.reusableWeightKg, locale, 1), b: formatNumber(r.totalWeightKg, locale, 1) })}</div></div>
            <div className="card"><div className="muted">{t("ppwr.totalIssued")}</div><div className="text-3xl font-bold">{formatNumber(r.totalPieces, locale)}</div><div className="muted">{t("common.pcs")}</div></div>
            <div className="card"><div className="muted">{t("ppwr.pending")}</div><div className="text-3xl font-bold text-amber-700">{r.pendingCount}</div><div className="muted">{t("ppwr.pendingHelp")}</div></div>
          </div>
          <section className="card overflow-x-auto">
            <h2 className="h2 mb-3">{t("ppwr.byType")}</h2>
            {r.types.length === 0 ? (
              <p className="muted">{t("ppwr.empty")}</p>
            ) : (
              <table className="table" data-testid="ppwr-table">
                <thead><tr><th>{t("packaging.type")}</th><th>{t("packaging.reusable")}</th><th className="text-right">{t("ppwr.issued")}</th><th className="text-right">{t("ppwr.weight")}</th><th className="text-right">{t("ppwr.avgPool")}</th><th className="text-right">{t("ppwr.rotations")}</th></tr></thead>
                <tbody>
                  {r.types.map((x) => (
                    <tr key={x.packagingTypeId} data-type={x.code}>
                      <td>{x.name} <span className="font-mono text-xs text-slate-500">{x.code}</span></td>
                      <td>{x.reusable ? t("common.yes") : t("common.no")}</td>
                      <td className="text-right tabular-nums">{formatNumber(x.pieces, locale)}</td>
                      <td className="text-right tabular-nums">{formatNumber(x.weightKg, locale, 1)}</td>
                      <td className="text-right tabular-nums">{x.avgPool === null ? "–" : formatNumber(x.avgPool, locale, 1)}</td>
                      <td className="text-right font-semibold tabular-nums">{x.rotations === null ? "–" : formatNumber(x.rotations, locale, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card text-sm">
            <h2 className="h2 mb-2">{t("ppwr.methodTitle")}</h2>
            <ul className="list-inside list-disc space-y-1 text-slate-700">
              <li>{t("ppwr.method1")}</li>
              <li>{t("ppwr.method2")}</li>
              <li>{t("ppwr.method3")}</li>
              <li>{t("ppwr.method4")}</li>
            </ul>
            <p className="muted mt-2">{t("ppwr.methodVersion", { v: r.method })}</p>
          </section>
          <a className="btn-secondary" href={`/api/v1/export/ppwr?from=${from.s}&to=${to.s}`}>{t("ppwr.exportCsv")}</a>
        </>
      )}
    </div>
  );
}
