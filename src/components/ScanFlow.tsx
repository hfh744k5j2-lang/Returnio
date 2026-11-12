"use client";
import { useActionState, useCallback, useEffect, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { useT } from "@/lib/i18n/client";
import { parseScanned } from "@/lib/scan";
import { QrScanner } from "./QrScanner";

type Partner = { id: string; name: string; code: string };
type PType = { id: string; code: string; name: string; owner: string };
type Kind = "ISSUE" | "RECEIPT" | "RETURN";

/**
 * Mobilní tok pro skladníka: 1) partner (QR nebo výběr), 2) výdej/příjem/vrácení,
 * 3) obaly (QR nebo výběr) a počty, 4) uložit.
 */
export function ScanFlow({
  action,
  partners,
  initialPartnerId,
  initialTypeId,
  today,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  partners: Partner[];
  initialPartnerId?: string;
  initialTypeId?: string;
  today: string;
}) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(action, null);
  const [partnerId, setPartnerId] = useState(initialPartnerId ?? "");
  const [kind, setKind] = useState<Kind>("ISSUE");
  const [returnDir, setReturnDir] = useState<"IN" | "OUT">("IN");
  const [types, setTypes] = useState<PType[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pendingType, setPendingType] = useState<string | undefined>(initialTypeId);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [clientKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())));

  useEffect(() => {
    if (!partnerId) return setTypes([]);
    let cancelled = false;
    fetch(`/api/v1/partners/${partnerId}`)
      .then((r) => (r.ok ? r.json() : { packagingTypes: [] }))
      .then((d) => !cancelled && setTypes(d.packagingTypes ?? []));
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  // obal naskenovaný dřív než partner – přidáme ho, jakmile známe typy partnera
  useEffect(() => {
    if (!pendingType || types.length === 0) return;
    if (types.some((x) => x.id === pendingType)) setCounts((c) => ({ ...c, [pendingType]: c[pendingType] ?? 0 }));
    else setNotice(t("scan.typeNotForPartner"));
    setPendingType(undefined);
  }, [pendingType, types, t]);

  const onScan = useCallback(
    (text: string) => {
      setScanning(false);
      const r = parseScanned(text);
      if (!r) return setNotice(t("scan.unknownCode"));
      setNotice(null);
      if (r.partner) {
        if (partners.some((p) => p.id === r.partner)) setPartnerId(r.partner);
        else setNotice(t("scan.unknownPartner"));
      }
      if (r.type) setPendingType(r.type);
    },
    [partners, t],
  );

  const partner = partners.find((p) => p.id === partnerId);
  const lines = Object.entries(counts).filter(([, q]) => q > 0).map(([packagingTypeId, quantity]) => ({ packagingTypeId, quantity }));
  const payload = JSON.stringify({
    partnershipId: partnerId,
    kind,
    direction: kind === "RETURN" ? returnDir : undefined,
    date: today,
    deliveryNote: deliveryNote || undefined,
    clientKey,
    lines,
  });
  const total = lines.reduce((a, l) => a + l.quantity, 0);

  return (
    <div className="space-y-4 pb-24">
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      {notice && <p className="alert-warn" role="alert">{notice}</p>}

      <section className="card space-y-3">
        <h2 className="h2">1. {t("scan.stepPartner")}</h2>
        {partner ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 p-3">
            <div>
              <div className="text-lg font-bold" data-testid="scan-partner">{partner.name}</div>
              <div className="font-mono text-sm text-slate-600">{partner.code}</div>
            </div>
            <button className="btn-secondary btn-sm" type="button" onClick={() => { setPartnerId(""); setCounts({}); }}>{t("scan.change")}</button>
          </div>
        ) : (
          <>
            <button type="button" className="btn-primary w-full py-4 text-base" onClick={() => setScanning(true)}>📷 {t("scan.scanPartner")}</button>
            <label className="label" htmlFor="s-partner">{t("scan.orChoose")}</label>
            <select id="s-partner" className="input" value="" onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{t("movementForm.choosePartner")}</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </>
        )}
      </section>

      {partner && (
        <section className="card space-y-3">
          <h2 className="h2">2. {t("scan.stepKind")}</h2>
          <div className="grid grid-cols-3 gap-2">
            {(["ISSUE", "RECEIPT", "RETURN"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-xl border-2 px-2 py-4 text-base font-bold ${kind === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"}`}
              >
                {t(`kinds.${k}`)}
              </button>
            ))}
          </div>
          <p className="muted">{t(`movementForm.kindHelp.${kind}`)}</p>
          {kind === "RETURN" && (
            <div className="grid gap-2">
              {(["IN", "OUT"] as const).map((d) => (
                <label key={d} className={`flex items-center gap-2 rounded-lg border px-3 py-3 ${returnDir === d ? "border-brand-600 bg-brand-50" : "border-slate-300"}`}>
                  <input type="radio" checked={returnDir === d} onChange={() => setReturnDir(d)} /> {t(`movementForm.direction.RETURN.${d}`)}
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {partner && (
        <section className="card space-y-3">
          <h2 className="h2">3. {t("scan.stepItems")}</h2>
          <button type="button" className="btn-secondary w-full py-4 text-base" onClick={() => setScanning(true)}>📷 {t("scan.scanType")}</button>
          <ul className="space-y-2">
            {types.map((ty) => {
              const q = counts[ty.id];
              const active = q !== undefined;
              return (
                <li key={ty.id} className={`rounded-lg border p-3 ${active ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`s-q-${ty.id}`} className="min-w-0">
                      <span className="font-semibold">{ty.name}</span> <span className="font-mono text-xs text-slate-500">{ty.code}</span>
                      <span className="block text-xs text-slate-500">{t("movementForm.owner", { owner: ty.owner })}</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-secondary h-12 w-12 text-xl" aria-label={t("scan.minus", { name: ty.name })} onClick={() => setCounts({ ...counts, [ty.id]: Math.max(0, (q ?? 0) - 1) })}>−</button>
                      <input
                        id={`s-q-${ty.id}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="input h-12 w-20 text-center text-xl font-bold"
                        aria-label={`${t("movementForm.count")} ${ty.name}`}
                        value={q ?? ""}
                        placeholder="0"
                        onChange={(e) => setCounts({ ...counts, [ty.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                      <button type="button" className="btn-secondary h-12 w-12 text-xl" aria-label={t("scan.plus", { name: ty.name })} onClick={() => setCounts({ ...counts, [ty.id]: (q ?? 0) + 1 })}>+</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div>
            <label className="label" htmlFor="s-dl">{t("movementForm.deliveryNote")}</label>
            <input id="s-dl" className="input" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} maxLength={60} />
          </div>
        </section>
      )}

      {partner && (
        <form action={formAction} className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 shadow-lg">
          <input type="hidden" name="payload" value={payload} />
          <input type="hidden" name="returnTo" value="scan" />
          {state?.error && <p className="alert-error mb-2">{state.error}</p>}
          <button className="btn-primary w-full py-4 text-lg" disabled={pending || lines.length === 0}>
            {pending ? t("movementForm.saving") : lines.length === 0 ? t("scan.enterCounts") : t("scan.save", { kind: t(`kinds.${kind}`), n: total })}
          </button>
        </form>
      )}
    </div>
  );
}
