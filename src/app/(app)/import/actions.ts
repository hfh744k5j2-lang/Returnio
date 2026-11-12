"use server";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/context";
import { runAction, type ActionState } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { guessMapping, parseCsv, previewImport, runImport, type ImportMapping } from "@/lib/services/csv";
import { assertCan } from "@/lib/permissions";

export async function analyze(text: string): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    assertCan(ctx.role, "import.run");
    const { headers, rows } = parseCsv(text);
    return { ok: true, data: { headers, sample: rows.slice(0, 5), rowCount: rows.length, mapping: guessMapping(headers) } };
  });
}

export async function preview(text: string, mapping: ImportMapping): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => ({ ok: true, data: await previewImport(ctx, text, mapping) }));
}

export async function commit(text: string, mapping: ImportMapping, fileName: string): Promise<ActionState> {
  const ctx = await requireCtx();
  try {
    const r = await runImport(ctx, text, mapping, fileName);
    revalidatePath("/movements");
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, data: e.details };
    throw e;
  }
}
