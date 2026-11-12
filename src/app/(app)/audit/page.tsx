import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listAudit } from "@/lib/services/audit";
import { getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/format";
import { NoAccess } from "@/components/NoAccess";

const TYPES = ["Movement", "Partnership", "PackagingType", "Company", "User", "Invitation", "ImportBatch"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  if (!can(ctx.role, "audit.view")) return <NoAccess t={t} />;
  const type = TYPES.includes(sp.type ?? "") ? sp.type : undefined;
  const data = await listAudit(ctx, { entityType: type, page: Number(sp.page) || 1, pageSize: 100 });
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-4">
      <h1 className="h1">{t("audit.title")}</h1>
      <p className="muted">{t("audit.intro")}</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/audit" className={`badge ${!type ? "bg-brand-600 text-white" : "bg-slate-200"}`}>{t("common.all")}</Link>
        {TYPES.map((x) => (
          <Link key={x} href={`/audit?type=${x}`} className={`badge ${type === x ? "bg-brand-600 text-white" : "bg-slate-200"}`}>{t(`audit.types.${x}`)}</Link>
        ))}
      </div>
      <section className="card overflow-x-auto p-0 sm:p-0">
        <table className="table" data-testid="audit-table">
          <thead><tr><th>{t("audit.when")}</th><th>{t("audit.who")}</th><th>{t("audit.what")}</th><th>{t("audit.detail")}</th></tr></thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{formatDateTime(a.createdAt, locale)}</td>
                <td>{a.actor}</td>
                <td>
                  {t(`audit.actions.${a.action}`)}
                  {a.entityType === "Movement" && <Link className="ml-1 text-brand-700 underline" href={`/movements/${a.entityId}`}>{t("common.detail")}</Link>}
                </td>
                <td className="max-w-md truncate font-mono text-xs text-slate-500" title={JSON.stringify(a.data)}>{a.data ? JSON.stringify(a.data) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {data.page > 1 && <Link className="btn-secondary btn-sm" href={`/audit?${new URLSearchParams({ ...(type ? { type } : {}), page: String(data.page - 1) })}`}>←</Link>}
          <span>{t("movements.page", { page: data.page, pages })}</span>
          {data.page < pages && <Link className="btn-secondary btn-sm" href={`/audit?${new URLSearchParams({ ...(type ? { type } : {}), page: String(data.page + 1) })}`}>→</Link>}
        </nav>
      )}
    </div>
  );
}
