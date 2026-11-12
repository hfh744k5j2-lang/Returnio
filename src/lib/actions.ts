import { AppError } from "./errors";

export type ActionState = { ok?: boolean; error?: string; message?: string; data?: unknown } | null;

/** Obalí serverovou akci: chyby služeb vrací jako text pro formulář, ostatní chyby loguje. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    // redirect() a notFound() z Next.js musí projít dál
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { error: "Něco se pokazilo. Zkuste to prosím znovu." };
  }
}
