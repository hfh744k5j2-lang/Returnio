import { requireCtx } from "@/lib/context";
import { listPackagingTypes } from "@/lib/services/packaging";
import { listPartners } from "@/lib/services/partners";
import { appUrl } from "@/lib/tokens";
import { getT } from "@/lib/i18n/server";
import { QrImage } from "@/components/QrImage";
import { PrintButton } from "@/components/PrintButton";

/** Tisk QR štítků: typy obalů (pro sken v aplikaci) a partneři (otevře skenování s partnerem). */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ type?: string; partner?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t } = await getT();
  const all = !sp.type && !sp.partner;
  const types = (await listPackagingTypes(ctx, { includeInactive: Boolean(sp.type) })).filter((x) => all || x.id === sp.type);
  const partners = (await listPartners(ctx)).filter((x) => all || x.id === sp.partner);
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <h1 className="h1">{t("labels.title")}</h1>
        <PrintButton label={t("labels.printNow")} />
      </div>
      <p className="no-print muted">{t("labels.help")}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {types.map((x) => (
          <div key={x.id} className="card break-inside-avoid text-center" data-testid="label-type">
            <QrImage value={appUrl(`/scan?type=${x.id}`)} size={150} />
            <div className="mt-2 font-mono text-lg font-bold">{x.code}</div>
            <div className="text-sm">{x.name}</div>
          </div>
        ))}
        {partners.map((x) => (
          <div key={x.id} className="card break-inside-avoid text-center" data-testid="label-partner">
            <QrImage value={appUrl(`/scan?partner=${x.id}`)} size={150} />
            <div className="mt-2 text-xs uppercase text-slate-500">{t("common.partner")}</div>
            <div className="font-bold">{x.name}</div>
            <div className="font-mono text-sm">{x.code}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
