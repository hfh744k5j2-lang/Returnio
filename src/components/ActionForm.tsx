"use client";
import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";

/** Formulář se serverovou akcí, který zobrazí chybu nebo potvrzení. */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  testId,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} data-testid={testId} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className="alert-error mt-3">
          {state.error}
        </p>
      )}
      {state?.ok && (state.message || successMessage) && (
        <p role="status" className="alert-ok mt-3">
          {state.message || successMessage}
        </p>
      )}
    </form>
  );
}
