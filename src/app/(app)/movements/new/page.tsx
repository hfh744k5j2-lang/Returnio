import type { MovementKind } from "@prisma/client";
import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { BASIC_KINDS, MOVEMENT_KINDS } from "@/lib/services/movements";
import { listPartners } from "@/lib/services/partners";
import { getT } from "@/lib/i18n/server";
import { todayLocal } from "@/lib/format";
import { MovementForm } from "@/components/MovementForm";
import { NoAccess } from "@/components/NoAccess";
import { create } from "../actions";

export default async function NewMovementPage({ searchParams }: { searchParams: Promise<{ partner?: string; kind?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t } = await getT();
  if (!can(ctx.role, "movements.create")) return <NoAccess t={t} />;
  const partners = await listPartners(ctx);
  const kinds = can(ctx.role, "movements.createSpecial") ? MOVEMENT_KINDS : BASIC_KINDS;
  const kind = kinds.includes(sp.kind as MovementKind) ? (sp.kind as MovementKind) : "ISSUE";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="h1">{t("movementForm.title")}</h1>
      {partners.length === 0 ? (
        <p className="alert-warn">{t("movementForm.noPartners")}</p>
      ) : (
        <div className="card">
          <MovementForm
            action={create}
            partners={partners.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
            kinds={kinds}
            initialPartnerId={partners.some((p) => p.id === sp.partner) ? sp.partner : undefined}
            initialKind={kind}
            today={todayLocal()}
          />
        </div>
      )}
    </div>
  );
}
