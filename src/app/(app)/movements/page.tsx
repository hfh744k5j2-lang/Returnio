import Link from "next/link";
import type { MovementKind, MovementStatus } from "@prisma/client";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listMovements, MOVEMENT_KINDS, type MovementFilters } from "@/lib/services/movements";
import { listPartners } from "@/lib/services/partners";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

const STATUSES: MovementStatus[] = ["PROPOSED", "DISPUTED", "CONFIRMED", "CANCELLED"];
const AWAITING = ["me", "dispute", "partner"] as const;

function validDate(v?: string) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  const filters: MovementFilters = {
    partnershipId: sp.partner || undefined,
    status: STATUSES.includes(sp.status as MovementStatus) ? (sp.status as MovementStatus) : undefined,
    kind: MOVEMENT_KINDS.includes(sp.kind as MovementKind) ? (sp.kind as MovementKind) : undefined,
    awaiting: (AWAITING as readonly string[]).includes(sp.awaiting ?? "") ? (sp.awaiting as MovementFilters["awaiting"]) : undefined,
    from: validDate(sp.from),
    to: validDate(sp.to),
    q: sp.q || undefined,
    page: Number(sp.page) || 1,
    pageSize: 50,
  };
  const [data, partners] = await Promise.all([listMovements(ctx, filters), listPartners(ctx)]);
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">{t("movements.title")}</h1>
        <div className="flex gap-2">
          {can(ctx.role, "export.run") && <a className="btn-secondary" href={`/api/v1/export/movements?${exportQs}`}>{t("movements.exportCsv")}</a>}
          {can(ctx.role, "movements.create") && <Link className="btn-primary" href="/movements/new">{t("dashboard.newMovement")}</Link>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/movements" className={`badge ${!filters.awaiting ? "bg-brand-600 text-white" : "bg-slate-200"}`}>{t("common.all")}</Link>
        {AWAITING.map((a) => (
          <Link key={a} href={`/movements?awaiting=${a}`} className={`badge ${filters.awaiting === a ? "bg-brand-600 text-white" : "bg-slate-200"}`}>{t(`movements.awaiting.${a}`)}</Link>
        ))}
      </div>

      <form className="card grid gap-3 sm:grid-cols-3 lg:grid-cols-6" method="get">
        {filters.awaiting && <input type="hidden" name="awaiting" value={filters.awaiting} />}
        <select name="partner" defaultValue={sp.partner ?? ""} className="input" aria-label={t("common.partner")}>
          <option value="">{t("movements.allPartners")}</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label={t("movements.status")}>
          <option value="">{t("movements.allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <select name="kind" defaultValue={sp.kind ?? ""} className="input" aria-label={t("movementForm.kind")}>
          <option value="">{t("movements.allKinds")}</option>
          {MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label={t("movements.from")} />
        <input type="date" name="to" defaultValue={sp.to} className="input" aria-label={t("movements.to")} />
        <div className="flex gap-2">
          <input name="q" defaultValue={sp.q} placeholder={t("movements.searchPlaceholder")} className="input" aria-label={t("common.search")} />
          <button className="btn-secondary">{t("common.filter")}</button>
        </div>
      </form>

      <section className="card overflow-x-auto p-0 sm:p-0">
        {data.items.length === 0 ? (
          <p className="muted p-4">{t("movements.empty")}</p>
        ) : (
          <table className="table" data-testid="movements-table">
            <thead>
              <tr>
                <th>{t("movements.number")}</th><th>{t("common.date")}</th><th>{t("common.partner")}</th><th>{t("movementForm.kind")}</th>
                <th>{t("movements.items")}</th><th>{t("movementForm.deliveryNote")}</th><th>{t("movements.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td><Link className="font-mono text-brand-700 underline" href={`/movements/${m.id}`}>{m.numberLabel}</Link></td>
                  <td className="whitespace-nowrap">{formatDate(m.date, locale)}</td>
                  <td>{m.partnerName}</td>
                  <td>
                    {t(`kinds.${m.kind}`)}
                    <span className="block text-xs text-slate-500">{m.direction === "OUT" ? t("movements.toPartner") : t("movements.fromPartner")}</span>
                  </td>
                  <td className="text-sm">
                    {m.lines.map((l) => (
                      <div key={l.id}>
                        {l.finalQuantity !== null && l.finalQuantity !== l.quantity ? (
                          <><s className="text-slate-400">{l.quantity}</s> {l.finalQuantity}</>
                        ) : (
                          l.finalQuantity ?? l.quantity
                        )}{" "}
                        × {l.code}
                      </div>
                    ))}
                  </td>
                  <td>{m.deliveryNote ?? "–"}</td>
                  <td>
                    <StatusBadge status={m.status} t={t} />
                    {m.can.confirm && <span className="block text-xs font-semibold text-amber-700">{t("movements.needsYou")}</span>}
                    {m.can.resolve && <span className="block text-xs font-semibold text-red-700">{t("movements.needsYou")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {data.page > 1 && <Link className="btn-secondary btn-sm" href={qs({ page: data.page - 1 })}>←</Link>}
          <span>{t("movements.page", { page: data.page, pages })}</span>
          {data.page < pages && <Link className="btn-secondary btn-sm" href={qs({ page: data.page + 1 })}>→</Link>}
        </nav>
      )}
    </div>
  );
}
