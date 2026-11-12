import Link from "next/link";
import { requireCtx } from "@/lib/context";
import { getMovement } from "@/lib/services/movements";
import { movementHistory } from "@/lib/services/audit";
import { orNotFound } from "@/lib/page";
import { getT } from "@/lib/i18n/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { directionKey } from "@/lib/direction";
import { ActionForm } from "@/components/ActionForm";
import { CorrectionForm } from "@/components/CorrectionForm";
import { accept, cancel, confirm, counter, dispute } from "../actions";

export default async function MovementDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t, locale } = await getT();
  const m = await orNotFound(getMovement(ctx, id));
  const history = await movementHistory(ctx, id);
  const open = m.corrections.find((c) => c.status === "OPEN");
  const typeName = (tid: string) => m.lines.find((l) => l.packagingTypeId === tid);
  const currentForResolve = open
    ? m.lines.map((l) => ({ packagingTypeId: l.packagingTypeId, name: l.name, code: l.code, current: open.lines.find((x) => x.packagingTypeId === l.packagingTypeId)?.quantity ?? l.quantity }))
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {sp.created && (
        <div className="alert-ok flex flex-wrap items-center justify-between gap-2" role="status">
          <span>{t("movementDetail.created", { number: m.numberLabel })}</span>
          {sp.from === "scan" && <Link className="btn-primary btn-sm" href="/scan">{t("movementDetail.scanNext")}</Link>}
        </div>
      )}
      <Link href="/movements" className="text-sm text-brand-700 underline">← {t("movements.title")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h1">{t(`kinds.${m.kind}`)} {m.numberLabel}</h1>
        <StatusBadge status={m.status} t={t} />
      </div>

      <section className="card space-y-3">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="muted">{t("common.partner")}</dt><dd className="font-medium">{m.partnerName}</dd></div>
          <div><dt className="muted">{t("common.date")}</dt><dd>{formatDate(m.date, locale)}</dd></div>
          <div><dt className="muted">{t("movementDetail.direction")}</dt><dd>{t(directionKey(m.kind, m.direction))}</dd></div>
          <div><dt className="muted">{t("movementForm.deliveryNote")}</dt><dd>{m.deliveryNote ?? "–"}</dd></div>
          <div><dt className="muted">{t("movementDetail.createdBy")}</dt><dd>{m.iAmCreator ? t("movementDetail.us") : m.partnerName}</dd></div>
          {m.note && <div className="sm:col-span-2"><dt className="muted">{t("movementForm.note")}</dt><dd>{m.note}</dd></div>}
        </dl>
        <table className="table" data-testid="movement-lines">
          <thead><tr><th>{t("packaging.type")}</th><th className="text-right">{t("movementDetail.proposed")}</th><th className="text-right">{t("movementDetail.final")}</th></tr></thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} <span className="font-mono text-xs text-slate-500">{l.code}</span><span className="block text-xs text-slate-500">{t("movementForm.owner", { owner: l.ownerName })}</span></td>
                <td className="text-right tabular-nums">{l.quantity}</td>
                <td className="text-right font-semibold tabular-nums">{l.finalQuantity ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {m.corrections.length > 0 && (
        <section className="card">
          <h2 className="h2 mb-3">{t("movementDetail.disputeHistory")}</h2>
          <ol className="space-y-3">
            {m.corrections.map((c) => (
              <li key={c.id} className={`rounded-lg border p-3 text-sm ${c.status === "OPEN" ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{c.byMe ? t("movementDetail.weProposed") : t("movementDetail.partnerProposed", { partner: m.partnerName })}</strong>
                  <span className="muted">{formatDateTime(c.createdAt, locale)} · {t(`correctionStatus.${c.status}`)}</span>
                </div>
                <p className="mt-1">„{c.reason}“</p>
                <ul className="mt-1">
                  {c.lines.map((x) => <li key={x.packagingTypeId}>{typeName(x.packagingTypeId)?.name}: <strong>{x.quantity}</strong> {t("common.pcs")}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(m.can.confirm || m.can.dispute) && (
        <section className="card space-y-4 border-amber-300">
          <h2 className="h2">{t("movementDetail.yourTurn")}</h2>
          <p className="muted">{t("movementDetail.confirmHelp")}</p>
          {m.can.confirm && (
            <ActionForm action={confirm}>
              <input type="hidden" name="id" value={m.id} />
              <button className="btn-primary w-full sm:w-auto">{t("movementDetail.confirm")}</button>
            </ActionForm>
          )}
          {m.can.dispute && (
            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer font-semibold text-red-700">{t("movementDetail.disputeOpen")}</summary>
              <div className="mt-3">
                <CorrectionForm
                  action={dispute}
                  movementId={m.id}
                  lines={m.lines.map((l) => ({ packagingTypeId: l.packagingTypeId, name: l.name, code: l.code, current: l.quantity }))}
                  submitLabel={t("movementDetail.disputeSubmit")}
                />
              </div>
            </details>
          )}
        </section>
      )}

      {m.can.resolve && open && (
        <section className="card space-y-4 border-red-300">
          <h2 className="h2">{t("movementDetail.resolveTitle")}</h2>
          <p className="muted">{t("movementDetail.resolveHelp", { partner: m.partnerName })}</p>
          <ActionForm action={accept}>
            <input type="hidden" name="id" value={m.id} />
            <button className="btn-primary w-full sm:w-auto">{t("movementDetail.acceptCorrection")}</button>
          </ActionForm>
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer font-semibold">{t("movementDetail.counterOpen")}</summary>
            <div className="mt-3">
              <CorrectionForm action={counter} movementId={m.id} lines={currentForResolve} submitLabel={t("movementDetail.counterSubmit")} />
            </div>
          </details>
        </section>
      )}

      {m.status === "PROPOSED" && !m.iAmCreator && !m.can.confirm && <p className="alert-warn">{t("movementDetail.officeConfirms")}</p>}
      {m.status === "DISPUTED" && open && !m.can.resolve && (
        <p className="alert-warn">{open.byMe ? t("movementDetail.waitingPartnerDecision") : t("movementDetail.needsOffice")}</p>
      )}
      {m.status === "PROPOSED" && m.iAmCreator && (
        <p className="alert-warn">{m.partnerRegistered ? t("movementDetail.waitingPartner") : t("movementDetail.waitingPartnerEmail")}</p>
      )}

      {m.can.cancel && (
        <ActionForm action={cancel}>
          <input type="hidden" name="id" value={m.id} />
          <button className="btn-secondary">{t("movementDetail.cancel")}</button>
        </ActionForm>
      )}

      <section className="card">
        <h2 className="h2 mb-3">{t("movementDetail.history")}</h2>
        <ol className="space-y-1 text-sm" data-testid="movement-history">
          {history.slice().reverse().map((h) => (
            <li key={h.id}><span className="muted">{formatDateTime(h.createdAt, locale)}</span> · {t(`audit.actions.${h.action}`)} · {h.actor}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
