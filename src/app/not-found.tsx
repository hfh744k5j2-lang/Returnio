import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="h1 mb-2">{t("errors.notFoundTitle")}</h1>
      <p className="muted mb-6">{t("errors.notFoundText")}</p>
      <Link className="btn-primary" href="/dashboard">{t("errors.backHome")}</Link>
    </main>
  );
}
