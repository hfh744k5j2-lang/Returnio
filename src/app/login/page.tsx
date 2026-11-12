import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { LangSwitch } from "@/components/LangSwitch";
import { requestMagicLink } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const next = sp.next || sp.callbackUrl || "/dashboard";
  if (session?.user) redirect(next.startsWith("/") ? next : "/dashboard");
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-2xl font-bold text-brand-700">ObalBook</span>
        <LangSwitch />
      </div>
      <div className="card">
        <h1 className="h1 mb-1">{t("login.title")}</h1>
        <p className="muted mb-5">{t("login.intro")}</p>
        {sp.error && <p className="alert-error mb-4">{t("login.error")}</p>}
        <ActionForm action={requestMagicLink} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="email">{t("common.email")}</label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="jmeno@firma.cz" />
          </div>
          <button className="btn-primary w-full" type="submit">{t("login.submit")}</button>
        </ActionForm>
        <p className="muted mt-4">{t("login.newCompany")}</p>
      </div>
    </main>
  );
}
