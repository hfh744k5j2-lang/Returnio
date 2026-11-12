import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listPartners } from "@/lib/services/partners";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { invite } from "./actions";

export default async function PartnersPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  const partners = await listPartners(ctx);
  return (
    <div className="space-y-6">
      <h1 className="h1">{t("partners.title")}</h1>
      <section className="card">
        {partners.length === 0 ? (
          <p className="muted">{t("partners.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table" data-testid="partners-table">
              <thead>
                <tr><th>{t("partners.name")}</th><th>{t("partners.code")}</th><th>{t("partners.state")}</th><th></th></tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}</td>
                    <td className="font-mono">{p.code}</td>
                    <td>
                      {p.registered ? (
                        <span className="badge bg-green-100 text-green-800">{t("partners.registered")}</span>
                      ) : (
                        <span className="badge bg-amber-100 text-amber-900">{t("partners.notRegistered")}</span>
                      )}
                    </td>
                    <td className="text-right"><Link className="text-brand-700 underline" href={`/partners/${p.id}`}>{t("common.detail")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can(ctx.role, "partners.manage") && (
        <section className="card">
          <h2 className="h2 mb-1">{t("partners.inviteTitle")}</h2>
          <p className="muted mb-4">{t("partners.inviteHelp")}</p>
          <ActionForm action={invite} className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end" successMessage={t("partners.inviteSent")} resetOnSuccess>
            <div>
              <label className="label" htmlFor="p-name">{t("partners.name")}</label>
              <input id="p-name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="p-email">{t("partners.email")}</label>
              <input id="p-email" name="email" type="email" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="p-code">{t("partners.codeOptional")}</label>
              <input id="p-code" name="code" className="input font-mono uppercase" maxLength={20} />
            </div>
            <button className="btn-primary">{t("partners.inviteSubmit")}</button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
