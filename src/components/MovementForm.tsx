"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { useT } from "@/lib/i18n/client";

type Partner = { id: string; name: string; code: string };
type PType = { id: string; code: string; name: string; owner: string };
type Kind = "ISSUE" | "RECEIPT" | "RETURN" | "LOSS" | "DAMAGE" | "CORRECTION";
const FIXED: Partial<Record<Kind, "OUT" | "IN">> = { ISSUE: "OUT", RECEIPT: "IN" };
const DEFAULT_DIR: Record<Kind, "OUT" | "IN"> = { ISSUE: "OUT", RECEIPT: "IN", RETURN: "IN", LOSS: "IN", DAMAGE: "IN", CORRECTION: "OUT" };

export function MovementForm({
  action,
  partners,
  kinds,
  initialPartnerId,
  initialKind = "ISSUE",
  initialTypeId,
  today,
  compact,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  partners: Partner[];
  kinds: Kind[];
  initialPartnerId?: string;
  initialKind?: Kind;
  initialTypeId?: string;
  today: string;
  compact?: boolean;
}) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(action, null);
  const [partnerId, setPartnerId] = useState(initialPartnerId ?? (partners.length === 1 ? partners[0].id : ""));
  const [kind, setKind] = useState<Kind>(initialKind);
  const [direction, setDirection] = useState<"OUT" | "IN">(DEFAULT_DIR[initialKind]);
  const [types, setTypes] = useState<PType[]>([]);
  const [qty, setQty] = useState<Record<string, string>>(initialTypeId ? { [initialTypeId]: "" } : {});
  const [date, setDate] = useState(today);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [note, setNote] = useState("");
  const [clientKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random())));

  useEffect(() => {
    if (!partnerId) {
      setTypes([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/partners/${partnerId}`)
      .then((r) => (r.ok ? r.json() : { packagingTypes: [] }))
      .then((d) => !cancelled && setTypes(d.packagingTypes ?? []));
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  const lines = useMemo(
    () =>
      Object.entries(qty)
        .filter(([, v]) => v !== "" && Number(v) > 0)
        .map(([packagingTypeId, v]) => ({ packagingTypeId, quantity: Number(v) })),
    [qty],
  );
  const fixed = FIXED[kind];
  const payload = JSON.stringify({
    partnershipId: partnerId,
    kind,
    direction: fixed ? undefined : direction,
    date,
    deliveryNote: deliveryNote || undefined,
    note: note || undefined,
    clientKey,
    lines,
  });
  const negative = Object.values(qty).some((v) => v !== "" && Number(v) < 0);

  return (
    <form action={formAction} className="space-y-5" data-testid="movement-form">
      <input type="hidden" name="payload" value={payload} />
      {compact && <input type="hidden" name="returnTo" value="scan" />}
      <div className={compact ? "space-y-4" : "grid gap-4 sm:grid-cols-2"}>
        <div>
          <label className="label" htmlFor="mf-partner">{t("common.partner")}</label>
          <select id="mf-partner" className="input" value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setQty({}); }} required>
            <option value="">{t("movementForm.choosePartner")}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">{t("movementForm.kind")}</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("movementForm.kind")}>
            {kinds.map((k) => (
              <button
                type="button"
                key={k}
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setDirection(DEFAULT_DIR[k]);
                }}
                className={`rounded-lg border px-2 py-3 text-sm font-semibold ${kind === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white"}`}
              >
                {t(`kinds.${k}`)}
              </button>
            ))}
          </div>
          <p className="muted mt-1">{t(`movementForm.kindHelp.${kind}`)}</p>
        </div>
      </div>

      {!fixed && (
        <fieldset>
          <legend className="label">{t(`movementForm.direction.${kind}.label`)}</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            {(["IN", "OUT"] as const).map((d) => (
              <label key={d} className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-3 text-sm ${direction === d ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white"}`}>
                <input type="radio" name="dir" checked={direction === d} onChange={() => setDirection(d)} />
                {t(`movementForm.direction.${kind}.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <span className="label">{t("movementForm.quantities")}</span>
        {!partnerId ? (
          <p className="muted">{t("movementForm.choosePartnerFirst")}</p>
        ) : types.length === 0 ? (
          <p className="muted">{t("movementForm.noTypes")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {types.map((ty) => (
              <li key={ty.id} className={`flex items-center justify-between gap-3 px-3 py-2 ${ty.id in qty ? "bg-brand-50" : ""}`}>
                <label htmlFor={`q-${ty.id}`} className="min-w-0 text-sm">
                  <span className="font-medium">{ty.name}</span> <span className="font-mono text-xs text-slate-500">{ty.code}</span>
                  <span className="block text-xs text-slate-500">{t("movementForm.owner", { owner: ty.owner })}</span>
                </label>
                <input
                  id={`q-${ty.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  className="input w-28 text-right text-lg"
                  placeholder="0"
                  aria-label={`${t("movementForm.count")} ${ty.name}`}
                  value={qty[ty.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [ty.id]: e.target.value })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={compact ? "space-y-4" : "grid gap-4 sm:grid-cols-3"}>
        <div>
          <label className="label" htmlFor="mf-date">{t("common.date")}</label>
          <input id="mf-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="mf-dl">{t("movementForm.deliveryNote")}</label>
          <input id="mf-dl" className="input" value={deliveryNote} maxLength={60} onChange={(e) => setDeliveryNote(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="mf-note">{t("movementForm.note")}</label>
          <input id="mf-note" className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {negative && <p className="alert-error">{t("movementForm.negative")}</p>}
      {state?.error && <p className="alert-error">{state.error}</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={pending || !partnerId || lines.length === 0 || negative}>
        {pending ? t("movementForm.saving") : t("movementForm.submit", { kind: t(`kinds.${kind}`).toLowerCase() })}
      </button>
      <p className="muted">{t("movementForm.afterSave")}</p>
    </form>
  );
}
