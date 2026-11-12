"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { useT } from "@/lib/i18n/client";
import { CorrectionForm } from "./CorrectionForm";

type Line = { packagingTypeId: string; name: string; code: string; current: number };
type Act = (p: ActionState, fd: FormData) => Promise<ActionState>;

/** Akce partnera bez registrace. Po úspěchu odkaz přestane platit, proto zobrazíme jen poděkování. */
export function PartnerLinkActions({
  token,
  mode,
  lines,
  confirmAction,
  disputeAction,
}: {
  token: string;
  mode: "confirm" | "resolve";
  lines: Line[];
  confirmAction: Act;
  disputeAction: Act;
}) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(confirmAction, null);
  const [disputeDone, setDisputeDone] = useState<string | null>(null);
  const done = (state?.ok && state.message) || disputeDone;
  if (done) return <p className="alert-ok text-base" role="status">{done}</p>;
  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label" htmlFor="pl-name">{t("partnerLink.yourName")}</label>
          <input id="pl-name" name="name" className="input" required minLength={2} autoComplete="name" />
        </div>
        {state?.error && <p className="alert-error">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {mode === "confirm" ? t("movementDetail.confirm") : t("movementDetail.acceptCorrection")}
        </button>
      </form>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold text-red-700">
          {mode === "confirm" ? t("movementDetail.disputeOpen") : t("movementDetail.counterOpen")}
        </summary>
        <div className="mt-3">
          <CorrectionForm
            action={disputeAction}
            lines={lines}
            hiddenFields={{ token }}
            withName
            onDone={setDisputeDone}
            submitLabel={mode === "confirm" ? t("movementDetail.disputeSubmit") : t("movementDetail.counterSubmit")}
          />
        </div>
      </details>
    </div>
  );
}
