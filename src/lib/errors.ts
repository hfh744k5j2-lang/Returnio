/** Chyby služeb. API je převádí na HTTP kódy, UI na srozumitelné hlášky. */
export class AppError extends Error {
  constructor(
    public code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "UNAUTHORIZED" | "RATE_LIMITED",
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Záznam") => new AppError("NOT_FOUND", `${what} nebyl nalezen.`);
export const forbidden = (msg = "Na tuto akci nemáte oprávnění.") => new AppError("FORBIDDEN", msg);
export const invalid = (msg: string, details?: unknown) => new AppError("VALIDATION", msg, details);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const tooManyAttempts = () =>
  new AppError("RATE_LIMITED", "Příliš mnoho pokusů za krátkou dobu. Počkejte prosím několik minut a zkuste to znovu.");

export function httpStatus(e: AppError): number {
  return { NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION: 400, CONFLICT: 409, UNAUTHORIZED: 401, RATE_LIMITED: 429 }[e.code];
}
