import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/context";
import { acceptInvitation, findInvitation } from "@/lib/services/companies";
import { runAction, type ActionState } from "@/lib/actions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  const inv = await findInvitation(token);
  const user = await currentUser();

  async function accept(_prev: ActionState): Promise<ActionState> {
    "use server";
    const u = await currentUser();
    if (!u) redirect(`/login?next=/invite/${token}`);
    const res = await runAction(async () => {
      await acceptInvitation(u.id, token);
    });
    if (res?.error) return res;
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <div className="card space-y-4">
        <h1 className="h1">{t("invite.title")}</h1>
        {!inv ? (
          <p className="alert-error">{t("invite.invalid")}</p>
        ) : (
          <>
            <p>{t("invite.text", { company: inv.company.name, role: t(`roles.${inv.role}`) })}</p>
            {!user ? (
              <Link className="btn-primary w-full" href={`/login?next=/invite/${token}`}>{t("invite.signInFirst", { email: inv.email })}</Link>
            ) : user.email.toLowerCase() !== inv.email.toLowerCase() ? (
              <p className="alert-warn">{t("invite.wrongEmail", { email: inv.email })}</p>
            ) : user.companyId && user.companyId !== inv.companyId ? (
              <p className="alert-warn">{t("invite.otherCompany")}</p>
            ) : (
              <ActionForm action={accept}>
                <button className="btn-primary w-full">{t("invite.accept")}</button>
              </ActionForm>
            )}
          </>
        )}
      </div>
    </main>
  );
}
