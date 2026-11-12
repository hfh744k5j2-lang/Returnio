"use client";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { useT } from "@/lib/i18n/client";

type Line = { packagingTypeId: string; name: string; code: string; current: number };

/** Formulář rozporu / protinávrhu: opravené počty + důvod. */
export function CorrectionForm({
  action,
  movementId,
  lines,
  submitLabel,
  hiddenFields,
  withName,
  onDone,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  movementId?: string;
  lines: Line[];
  submitLabel: string;
  hiddenFields?: Record<string, string>;
  withName?: boolean;
  onDone?: (message: string) => void;
}) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(action, null);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.packagingTypeId, String(l.current)])));
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (state?.ok && state.message) onDone?.(state.message);
  }, [state, onDone]);
  if (state?.ok && state.message) return <p className="alert-ok text-base" role="status">{state.message}</p>;
  const payload = JSON.stringify({
    reason,
    lines: lines.map((l) => ({ packagingTypeId: l.packagingTypeId, quantity: qty[l.packagingTypeId] === "" ? NaN : Number(qty[l.packagingTypeId]) })),
  });
  return (
    <form action={formAction} className="space-y-3" data-testid="correction-form">
      {movementId && <input type="hidden" name="id" value={movementId} />}
      {Object.entries(hiddenFields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="payload" value={payload} />
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.packagingTypeId} className="flex items-center justify-between gap-3">
            <label htmlFor={`c-${l.packagingTypeId}`} className="text-sm">
              {l.name} <span className="font-mono text-xs text-slate-500">{l.code}</span>
              <span className="block text-xs text-slate-500">{t("correction.wasProposed", { n: l.current })}</span>
            </label>
            <input
              id={`c-${l.packagingTypeId}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="input w-28 text-right text-lg"
              aria-label={t("correction.realCount", { name: l.name })}
              value={qty[l.packagingTypeId]}
              onChange={(e) => setQty({ ...qty, [l.packagingTypeId]: e.target.value })}
            />
          </li>
        ))}
      </ul>
      <div>
        <label className="label" htmlFor="c-reason">{t("correction.reason")}</label>
        <textarea id="c-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder={t("correction.reasonPlaceholder")} />
      </div>
      {withName && (
        <div>
          <label className="label" htmlFor="c-name">{t("partnerLink.yourName")}</label>
          <input id="c-name" name="name" className="input" required minLength={2} autoComplete="name" />
        </div>
      )}
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && state.message && <p className="alert-ok">{state.message}</p>}
      <button className="btn-danger" disabled={pending}>{submitLabel}</button>
    </form>
  );
}
