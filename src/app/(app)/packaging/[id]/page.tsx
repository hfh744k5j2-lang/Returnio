import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/context";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { NoAccess } from "@/components/NoAccess";
import { getPackagingType } from "@/lib/services/packaging";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/ActionForm";
import { PackagingFields } from "@/components/PackagingFields";
import { update } from "../actions";

export default async function EditPackaging({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const { t } = await getT();
  if (!can(ctx.role, "packaging.manage")) return <NoAccess t={t} />;
  const p = await getPackagingType(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <Link href="/packaging" className="text-sm text-brand-700 underline">← {t("packaging.title")}</Link>
      <h1 className="h1">{t("packaging.editTitle", { code: p.code })}</h1>
      <section className="card">
        <ActionForm action={update} className="space-y-4">
          <input type="hidden" name="id" value={p.id} />
          <PackagingFields
            t={t}
            showActive
            d={{ ...p, weightKg: p.weightKg.toString(), deposit: p.deposit?.toString() ?? null }}
          />
          <p className="muted">{t("packaging.editWarning")}</p>
          <button className="btn-primary">{t("common.save")}</button>
        </ActionForm>
      </section>
    </div>
  );
}
