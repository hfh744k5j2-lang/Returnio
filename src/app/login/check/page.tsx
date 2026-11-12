import { getT } from "@/lib/i18n/server";

export default async function CheckEmailPage() {
  const { t } = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="card text-center">
        <div className="mb-3 text-4xl" aria-hidden>✉️</div>
        <h1 className="h1 mb-2">{t("login.checkTitle")}</h1>
        <p className="muted">{t("login.checkText")}</p>
      </div>
    </main>
  );
}
