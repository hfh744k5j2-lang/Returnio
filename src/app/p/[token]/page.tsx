import { findPartnerLink } from "@/lib/services/movements";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import { LangSwitch } from "@/components/LangSwitch";
import { PartnerLinkActions } from "@/components/PartnerLinkActions";
import { acceptLink, confirmLink, counterLink, disputeLink } from "./actions";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Veřejná stránka pro partnera bez registrace – potvrzení nebo rozporování jednoho pohybu. */
export default async function PartnerLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getT();
  const found = await findPartnerLink(token);
  const m = found?.view;
  const companyName = found?.movement.partnership.companyA.name;
  const open = m?.corrections.find((c) => c.status === "OPEN");
  const resolveMode = m?.status === "DISPUTED" && open && !open.byMe;

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-700">ObalBook</span>
        <LangSwitch />
      </div>
      {!m ? (
        <div className="card"><h1 className="h1 mb-2">{t("partnerLink.invalidTitle")}</h1><p className="muted">{t("partnerLink.invalidText")}</p></div>
      ) : (
        <div className="card space-y-4">
          <h1 className="h1">{resolveMode ? t("partnerLink.resolveTitle", { company: companyName ?? "" }) : t("partnerLink.title", { company: companyName ?? "" })}</h1>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="muted">{t("movements.number")}</dt><dd className="font-mono">{m.numberLabel}</dd></div>
            <div><dt className="muted">{t("common.date")}</dt><dd>{formatDate(m.date, locale)}</dd></div>
            <div><dt className="muted">{t("movementForm.kind")}</dt><dd>{t(`kinds.${m.kind}`)}</dd></div>
            <div><dt className="muted">{t("movementDetail.direction")}</dt><dd>{m.direction === "IN" ? t("partnerLink.toYou", { company: companyName ?? "" }) : t("partnerLink.fromYou", { company: companyName ?? "" })}</dd></div>
            {m.deliveryNote && <div className="col-span-2"><dt className="muted">{t("movementForm.deliveryNote")}</dt><dd>{m.deliveryNote}</dd></div>}
          </dl>
          <table className="table">
            <thead><tr><th>{t("packaging.type")}</th><th className="text-right">{resolveMode ? t("partnerLink.proposedNow") : t("movementDetail.proposed")}</th></tr></thead>
            <tbody>
              {m.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} <span className="font-mono text-xs text-slate-500">{l.code}</span></td>
                  <td className="text-right text-lg font-bold tabular-nums">{open?.lines.find((x) => x.packagingTypeId === l.packagingTypeId)?.quantity ?? l.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {resolveMode && open && <p className="alert-warn">{t("partnerLink.theirReason")}: „{open.reason}“</p>}
          {m.status === "PROPOSED" || resolveMode ? (
            <PartnerLinkActions
              token={token}
              mode={resolveMode ? "resolve" : "confirm"}
              lines={m.lines.map((l) => ({ packagingTypeId: l.packagingTypeId, name: l.name, code: l.code, current: open?.lines.find((x) => x.packagingTypeId === l.packagingTypeId)?.quantity ?? l.quantity }))}
              confirmAction={resolveMode ? acceptLink : confirmLink}
              disputeAction={resolveMode ? counterLink : disputeLink}
            />
          ) : (
            <p className="muted">{t("partnerLink.nothingToDo")}</p>
          )}
          <p className="muted border-t border-slate-100 pt-3">{t("partnerLink.registerHint")}</p>
        </div>
      )}
    </main>
  );
}
