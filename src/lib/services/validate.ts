import type { z } from "zod";
import { invalid } from "../errors";

/** Validace vstupu – při chybě vyhodí VALIDATION s první srozumitelnou hláškou. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw invalid(first?.message ?? "Neplatná data.", r.error.flatten());
  }
  return r.data;
}

/** Převod FormData na prostý objekt (prázdné řetězce → undefined). */
export function formToObject(fd: FormData): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") o[k] = v === "" ? undefined : v;
  }
  return o;
}
