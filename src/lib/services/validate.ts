import { z } from "zod";
import { invalid } from "../errors";

/** České hlášky pro pravidla, u kterých služba nezadala vlastní text. */
const czechErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if ((issue.expected as string) === "integer") return { message: "Zadejte celé číslo." };
      if (issue.received === "undefined" || issue.received === "null") return { message: "Vyplňte povinné pole." };
      if (issue.expected === "number") return { message: "Zadejte číslo." };
      return { message: "Neplatná hodnota." };
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") return { message: `Text musí mít alespoň ${issue.minimum} znaků.` };
      if (issue.type === "array") return { message: "Vyplňte alespoň jednu položku." };
      return { message: `Hodnota musí být alespoň ${issue.minimum}.` };
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `Text může mít nejvýše ${issue.maximum} znaků.` };
      if (issue.type === "array") return { message: "Příliš mnoho položek." };
      return { message: `Hodnota může být nejvýše ${issue.maximum}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Vyberte jednu z nabízených možností." };
    case z.ZodIssueCode.invalid_string:
      return { message: "Neplatný formát." };
    case z.ZodIssueCode.invalid_date:
      return { message: "Neplatné datum." };
    case z.ZodIssueCode.not_finite:
      return { message: "Zadejte číslo." };
    default:
      return { message: ctx.defaultError };
  }
};
z.setErrorMap(czechErrorMap);

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
