import { redirect } from "next/navigation";
import { currentUser } from "@/lib/context";
import { createCompanyForUser } from "@/lib/services/companies";
import { formToObject } from "@/lib/services/validate";
import { runAction, type ActionState } from "@/lib/actions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { CompanyFields } from "@/components/CompanyFields";
import { SignOutButton } from "@/components/SignOutButton";

async function createCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/login");
  const res = await runAction(async () => {
    await createCompanyForUser(user.id, formToObject(fd));
  });
  if (res?.error) return res;
  redirect("/dashboard");
}

export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/onboarding");
  if (user.companyId) redirect("/dashboard");
  const { t } = await getT();
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-700">ObalBook</span>
        <SignOutButton label={t("nav.signOut")} />
      </div>
      <div className="card">
        <h1 className="h1 mb-1">{t("onboarding.title")}</h1>
        <p className="muted mb-5">{t("onboarding.intro", { email: user.email })}</p>
        <ActionForm action={createCompany} className="space-y-4">
          <CompanyFields t={t} />
          <button className="btn-primary w-full">{t("onboarding.submit")}</button>
        </ActionForm>
        <p className="muted mt-5">{t("onboarding.inviteHint")}</p>
      </div>
    </main>
  );
}
