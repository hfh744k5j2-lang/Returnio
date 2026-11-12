"use server";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/safe-next";

export async function requestMagicLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  if (!email.success) return { error: "Zadejte platný e-mail." };
  const redirectTo = safeNext(String(fd.get("next") || ""));
  // signIn odešle e-mail a přesměruje na /login/check (vyhazuje NEXT_REDIRECT)
  await signIn("email", { email: email.data, redirectTo });
  return { ok: true };
}
