"use server";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/context";
import { runAction, type ActionState } from "@/lib/actions";
import { formToObject } from "@/lib/services/validate";
import { invitePartner, resendPartnerInvite, updatePartner } from "@/lib/services/partners";

export async function invite(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await invitePartner(ctx, formToObject(fd));
    revalidatePath("/partners");
  });
}

export async function update(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const id = String(fd.get("id"));
  return runAction(async () => {
    await updatePartner(ctx, id, formToObject(fd));
    revalidatePath(`/partners/${id}`);
  });
}

export async function resend(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await resendPartnerInvite(ctx, String(fd.get("id")));
  });
}
