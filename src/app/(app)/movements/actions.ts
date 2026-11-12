"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/context";
import { runAction, type ActionState } from "@/lib/actions";
import { invalid } from "@/lib/errors";
import {
  acceptCorrection,
  cancelMovement,
  confirmMovement,
  counterCorrection,
  createMovement,
  disputeMovement,
} from "@/lib/services/movements";

function jsonField(fd: FormData, name: string): unknown {
  try {
    return JSON.parse(String(fd.get(name) ?? ""));
  } catch {
    throw invalid("Neplatná data formuláře.");
  }
}

export async function create(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  let id = "";
  const res = await runAction(async () => {
    const m = await createMovement(ctx, jsonField(fd, "payload"));
    id = m.id;
    revalidatePath("/movements");
  });
  if (res?.error) return res;
  redirect(`/movements/${id}?created=1${fd.get("returnTo") === "scan" ? "&from=scan" : ""}`);
}

async function act(fd: FormData, fn: (id: string) => Promise<unknown>) {
  const id = String(fd.get("id"));
  const res = await runAction(async () => {
    await fn(id);
    revalidatePath(`/movements/${id}`);
    revalidatePath("/movements");
  });
  return res;
}

export async function confirm(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return act(fd, (id) => confirmMovement(ctx, id));
}

export async function cancel(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return act(fd, (id) => cancelMovement(ctx, id));
}

export async function accept(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return act(fd, (id) => acceptCorrection(ctx, id));
}

export async function dispute(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return act(fd, (id) => disputeMovement(ctx, id, jsonField(fd, "payload")));
}

export async function counter(_p: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  return act(fd, (id) => counterCorrection(ctx, id, jsonField(fd, "payload")));
}
