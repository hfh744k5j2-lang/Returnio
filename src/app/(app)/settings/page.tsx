import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getCompany, listInvitations, listUsers } from "@/lib/services/companies";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { CompanyFields } from "@/components/CompanyFields";
import { invite, remove, revoke, saveCompany, setRole } from "./actions";

const ROLES = ["ADMIN", "LOGISTIK", "SKLAD"] as const;

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  const company = await getCompany(ctx);
  const users = await listUsers(ctx);
  const isAdmin = can(ctx.role, "users.manage");
  const invitations = isAdmin ? await listInvitations(ctx) : [];

  return (
    <div className="space-y-6">
      <h1 className="h1">{t("settings.title")}</h1>

      <section className="card">
        <h2 className="h2 mb-4">{t("settings.company")}</h2>
        {can(ctx.role, "company.manage") ? (
          <ActionForm action={saveCompany} className="space-y-4" successMessage={t("common.saved")}>
            <CompanyFields t={t} defaults={company} />
            <div>
              <label className="label" htmlFor="balanceAlertLimit">{t("settings.balanceAlertLimit")}</label>
              <input id="balanceAlertLimit" name="balanceAlertLimit" type="number" min={1} className="input max-w-xs" defaultValue={company.balanceAlertLimit ?? ""} />
              <p className="muted mt-1">{t("settings.balanceAlertLimitHelp")}</p>
            </div>
            <button className="btn-primary">{t("common.save")}</button>
          </ActionForm>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="muted">{t("company.name")}</dt><dd>{company.name}</dd></div>
            <div><dt className="muted">{t("company.regNumber")}</dt><dd>{company.regNumber ?? "–"}</dd></div>
          </dl>
        )}
      </section>

      <section className="card">
        <h2 className="h2 mb-4">{t("settings.users")}</h2>
        <div className="overflow-x-auto">
          <table className="table" data-testid="users-table">
            <thead>
              <tr><th>{t("common.email")}</th><th>{t("settings.role")}</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}{u.id === ctx.userId && <span className="muted"> ({t("settings.you")})</span>}</td>
                  <td>
                    {isAdmin ? (
                      <ActionForm action={setRole} className="flex gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" defaultValue={u.role ?? "SKLAD"} className="input max-w-[10rem]" aria-label={t("settings.role")}>
                          {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                        </select>
                        <button className="btn-secondary btn-sm">{t("common.save")}</button>
                      </ActionForm>
                    ) : (
                      t(`roles.${u.role}`)
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      {u.id !== ctx.userId && (
                        <ActionForm action={remove}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="btn-secondary btn-sm">{t("settings.removeUser")}</button>
                        </ActionForm>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted mt-3">{t("settings.rolesHelp")}</p>
      </section>

      {isAdmin && (
        <section className="card">
          <h2 className="h2 mb-4">{t("settings.inviteTitle")}</h2>
          <ActionForm action={invite} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" successMessage={t("settings.inviteSent")} resetOnSuccess>
            <div>
              <label className="label" htmlFor="inv-email">{t("common.email")}</label>
              <input id="inv-email" name="email" type="email" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="inv-role">{t("settings.role")}</label>
              <select id="inv-role" name="role" className="input" defaultValue="SKLAD">
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </select>
            </div>
            <button className="btn-primary">{t("settings.inviteSubmit")}</button>
          </ActionForm>
          {invitations.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span>{i.email} · {t(`roles.${i.role}`)} · <span className="muted">{t("settings.invitePending")}</span></span>
                  <ActionForm action={revoke}>
                    <input type="hidden" name="invitationId" value={i.id} />
                    <button className="btn-secondary btn-sm">{t("settings.revoke")}</button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
