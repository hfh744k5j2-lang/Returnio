import { requireCtx } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listPartners } from "@/lib/services/partners";
import { getT } from "@/lib/i18n/server";
import { todayLocal } from "@/lib/format";
import { ScanFlow } from "@/components/ScanFlow";
import { NoAccess } from "@/components/NoAccess";
import { create } from "../movements/actions";

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ partner?: string; type?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t } = await getT();
  if (!can(ctx.role, "movements.create")) return <NoAccess t={t} />;
  const partners = await listPartners(ctx);
  // ID z QR kódu ověřujeme proti vlastním partnerům (cizí ID se ignoruje)
  const initialPartnerId = partners.some((p) => p.id === sp.partner) ? sp.partner : undefined;
  return (
    <div className="mx-auto max-w-lg space-y-3">
      <h1 className="h1">{t("scan.title")}</h1>
      {sp.partner && !initialPartnerId && <p className="alert-warn">{t("scan.unknownPartner")}</p>}
      {partners.length === 0 ? (
        <p className="alert-warn">{t("movementForm.noPartners")}</p>
      ) : (
        <ScanFlow
          action={create}
          partners={partners.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
          initialPartnerId={initialPartnerId}
          initialTypeId={sp.type && /^[a-z0-9]{10,40}$/i.test(sp.type) ? sp.type : undefined}
          today={todayLocal()}
        />
      )}
    </div>
  );
}
