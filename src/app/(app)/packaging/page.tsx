import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listPackagingTypes } from "@/lib/services/packaging";
import { getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { PackagingFields } from "@/components/PackagingFields";
import { create } from "./actions";

export default async function PackagingPage() {
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  const types = await listPackagingTypes(ctx, { includeInactive: true });
  const manage = can(ctx.role, "packaging.manage");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">{t("packaging.title")}</h1>
        {types.length > 0 && <Link className="btn-secondary" href="/labels">{t("labels.printAll")}</Link>}
      </div>
      <section className="card">
        {types.length === 0 ? (
          <p className="muted">{t("packaging.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table" data-testid="packaging-table">
              <thead>
                <tr>
                  <th>{t("packaging.code")}</th><th>{t("packaging.name")}</th><th>{t("packaging.material")}</th>
                  <th className="text-right">{t("packaging.weightKg")}</th><th className="text-right">{t("packaging.deposit")}</th>
                  <th>{t("packaging.reusable")}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {types.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                    <td className="font-mono">{p.code}</td>
                    <td>{p.name}{!p.active && <span className="muted"> ({t("packaging.inactive")})</span>}</td>
                    <td>{p.material ?? "–"}</td>
                    <td className="text-right tabular-nums">{formatNumber(Number(p.weightKg), locale, 1)}</td>
                    <td className="text-right tabular-nums">{p.deposit ? `${formatNumber(Number(p.deposit), locale, 2)} ${p.currency === "CZK" ? "Kč" : "EUR"}` : "–"}</td>
                    <td>{p.reusable ? t("common.yes") : t("common.no")}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link className="text-brand-700 underline" href={`/labels?type=${p.id}`}>QR</Link>
                      {manage && <> · <Link className="text-brand-700 underline" href={`/packaging/${p.id}`}>{t("common.edit")}</Link></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted mt-3">{t("packaging.reusableHelp")}</p>
      </section>
      {manage && (
        <section className="card">
          <h2 className="h2 mb-4">{t("packaging.add")}</h2>
          <ActionForm action={create} className="space-y-4" successMessage={t("packaging.added")} resetOnSuccess>
            <PackagingFields t={t} />
            <button className="btn-primary">{t("packaging.addSubmit")}</button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
