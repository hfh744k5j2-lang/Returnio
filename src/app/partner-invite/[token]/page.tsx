import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, getCtx } from "@/lib/context";
import { createCompanyForUser } from "@/lib/services/companies";
import { acceptPartnerInvite, findPartnerInvite } from "@/lib/services/partners";
import { formToObject } from "@/lib/services/validate";
import { runAction, type ActionState } from "@/lib/actions";
import { can } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { CompanyFields } from "@/components/CompanyFields";

export default async function PartnerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const invite = await findPartnerInvite(token);
  const user = await currentUser();

  async function registerAndAccept(_prev: ActionState, fd: FormData): Promise<ActionState> {
    "use server";
    const u = await currentUser();
    if (!u) redirect(`/login?next=/partner-invite/${token}`);
    const res = await runAction(async () => {
      if (!u.companyId) await createCompanyForUser(u.id, formToObject(fd));
      const ctx = await getCtx();
      if (!ctx) throw new Error("no ctx");
      await acceptPartnerInvite(ctx, token);
    });
    if (res?.error) return res;
    redirect("/partners");
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="card space-y-4">
        <h1 className="h1">{t("partnerInvite.title")}</h1>
        {!invite ? (
          <p className="alert-error">{t("partnerInvite.invalid")}</p>
        ) : (
          <>
            <p>{t("partnerInvite.text", { company: invite.companyA.name })}</p>
            {!user ? (
              <>
                <Link className="btn-primary w-full" href={`/login?next=/partner-invite/${token}`}>{t("partnerInvite.signIn")}</Link>
                <p className="muted">{t("partnerInvite.noRegistration")}</p>
              </>
            ) : !user.companyId ? (
              <ActionForm action={registerAndAccept} className="space-y-4">
                <p className="muted">{t("partnerInvite.createCompany")}</p>
                <CompanyFields t={t} defaults={{ name: invite.invitedName }} />
                <button className="btn-primary w-full">{t("partnerInvite.registerAndAccept")}</button>
              </ActionForm>
            ) : user.role && can(user.role, "partners.manage") ? (
              <ActionForm action={registerAndAccept}>
                <p className="mb-3">{t("partnerInvite.asCompany", { company: user.company?.name ?? "" })}</p>
                <button className="btn-primary w-full">{t("partnerInvite.accept")}</button>
              </ActionForm>
            ) : (
              <p className="alert-warn">{t("partnerInvite.needRole")}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
