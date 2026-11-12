"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/context";
import { runAction, type ActionState } from "@/lib/actions";
import { formToObject } from "@/lib/services/validate";
import { createPackagingType, updatePackagingType } from "@/lib/services/packaging";

function fields(fd: FormData) {
  const o = formToObject(fd);
  return {
    ...o,
    material: o.material ?? null, // prázdné pole = smazat
    deposit: o.deposit ?? null,
    reusable: fd.get("reusable") === "on",
    active: fd.has("activePresent") ? fd.get("active") === "on" : undefined,
  };
}

export async function create(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await createPackagingType(ctx, fields(fd));
    revalidatePath("/packaging");
  });
}

export async function update(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const res = await runAction(async () => {
    await updatePackagingType(ctx, String(fd.get("id")), fields(fd));
    revalidatePath("/packaging");
  });
  if (res?.error) return res;
  redirect("/packaging");
}
