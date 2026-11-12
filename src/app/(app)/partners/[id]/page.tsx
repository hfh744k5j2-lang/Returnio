import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { getPartner } from "@/lib/services/partners";
import { getBalances } from "@/lib/services/balance";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { QrImage } from "@/components/QrImage";
import { appUrl } from "@/lib/tokens";
import { resend, update } from "../actions";

export default async function PartnerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const { t } = await getT();
  const partner = await getPartner(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { rows } = await getBalances(ctx, { partnershipId: id });
  const manage = can(ctx.role, "partners.manage");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/partners" className="text-sm text-brand-700 underline">← {t("partners.title")}</Link>
        <h1 className="h1 mt-1">{partner.name}</h1>
        <p className="muted">
          {t("partners.code")}: <span className="font-mono">{partner.code}</span> ·{" "}
          {partner.registered ? t("partners.registered") : t("partners.notRegistered")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {can(ctx.role, "movements.create") && <Link className="btn-primary" href={`/movements/new?partner=${id}`}>{t("dashboard.newMovement")}</Link>}
        <Link className="btn-secondary" href={`/movements?partner=${id}`}>{t("partners.movements")}</Link>
        <Link className="btn-secondary" href={`/balances?partner=${id}`}>{t("nav.balances")}</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
        <section className="card">
          <h2 className="h2 mb-3">{t("balances.title")}</h2>
          {rows.length === 0 ? (
            <p className="muted">{t("balances.empty")}</p>
          ) : (
            <table className="table">
              <thead><tr><th>{t("packaging.type")}</th><th className="text-right">{t("balances.confirmed")}</th><th className="text-right">{t("balances.pending")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.packagingTypeId}>
                    <td>{r.typeName} <span className="font-mono text-xs text-slate-500">{r.typeCode}</span></td>
                    <td className="text-right font-semibold tabular-nums">{r.confirmed}</td>
                    <td className="text-right tabular-nums text-slate-500">{r.pending || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted mt-3">{t("balances.signHelp")}</p>
        </section>

        <section className="card text-center">
          <h2 className="h2 mb-2">{t("partners.qrTitle")}</h2>
          <QrImage value={appUrl(`/scan?partner=${id}`)} size={180} label={`${partner.name} (${partner.code})`} />
          <p className="muted mt-2 max-w-[14rem]">{t("partners.qrHelp")}</p>
          <Link className="mt-2 inline-block text-sm text-brand-700 underline" href={`/labels?partner=${id}`}>{t("labels.print")}</Link>
        </section>
      </div>

      {manage && (
        <section className="card">
          <h2 className="h2 mb-4">{t("partners.edit")}</h2>
          <ActionForm action={update} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" successMessage={t("common.saved")}>
            <input type="hidden" name="id" value={id} />
            <div>
              <label className="label" htmlFor="e-name">{t("partners.name")}</label>
              <input id="e-name" name="name" className="input" defaultValue={partner.name} disabled={partner.registered} />
            </div>
            <div>
              <label className="label" htmlFor="e-code">{t("partners.code")}</label>
              <input id="e-code" name="code" required className="input font-mono uppercase" defaultValue={partner.code} maxLength={20} />
            </div>
            <button className="btn-primary">{t("common.save")}</button>
          </ActionForm>
          {partner.side === "A" && !partner.registered && (
            <ActionForm action={resend} className="mt-4" successMessage={t("partners.inviteSent")}>
              <input type="hidden" name="id" value={id} />
              <p className="muted mb-2">{t("partners.pendingHelp", { email: partner.email ?? "" })}</p>
              <button className="btn-secondary">{t("partners.resend")}</button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
