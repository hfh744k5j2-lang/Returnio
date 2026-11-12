"use server";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { requireCtx } from "@/lib/context";
import { runAction, type ActionState } from "@/lib/actions";
import { formToObject } from "@/lib/services/validate";
import { changeUserRole, inviteUser, removeUser, revokeInvitation, updateCompany } from "@/lib/services/companies";

export async function saveCompany(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    const o = formToObject(fd);
    await updateCompany(ctx, { ...o, balanceAlertLimit: o.balanceAlertLimit ?? null });
    revalidatePath("/settings");
  });
}

export async function invite(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await inviteUser(ctx, formToObject(fd));
    revalidatePath("/settings");
  });
}

export async function setRole(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await changeUserRole(ctx, String(fd.get("userId")), String(fd.get("role")) as Role);
    revalidatePath("/settings");
  });
}

export async function remove(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await removeUser(ctx, String(fd.get("userId")));
    revalidatePath("/settings");
  });
}

export async function revoke(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return runAction(async () => {
    await revokeInvitation(ctx, String(fd.get("invitationId")));
    revalidatePath("/settings");
  });
}
