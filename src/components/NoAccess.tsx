import Link from "next/link";
import type { TFn } from "@/lib/i18n/core";

export function NoAccess({ t }: { t: TFn }) {
  return (
    <div className="card mx-auto max-w-md text-center">
      <h1 className="h2 mb-2">{t("errors.noAccessTitle")}</h1>
      <p className="muted mb-4">{t("errors.noAccessText")}</p>
      <Link className="btn-secondary" href="/dashboard">{t("errors.backHome")}</Link>
    </div>
  );
}
