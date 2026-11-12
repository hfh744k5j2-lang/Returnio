"use server";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/actions";

export async function requestMagicLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  if (!email.success) return { error: "Zadejte platný e-mail." };
  const next = String(fd.get("next") || "/dashboard");
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  // signIn odešle e-mail a přesměruje na /login/check (vyhazuje NEXT_REDIRECT)
  await signIn("email", { email: email.data, redirectTo });
  return { ok: true };
}
