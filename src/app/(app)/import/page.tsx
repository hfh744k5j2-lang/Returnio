import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server";
import { NoAccess } from "@/components/NoAccess";
import { ImportWizard } from "@/components/ImportWizard";
import { analyze, commit, preview } from "./actions";

export default async function ImportPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  if (!can(ctx.role, "import.run")) return <NoAccess t={t} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="h1">{t("import.title")}</h1>
      <p className="muted">{t("import.intro")}</p>
      <ImportWizard analyze={analyze} preview={preview} commit={commit} />
    </div>
  );
}
