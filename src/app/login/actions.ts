"use server";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/actions";
import { safeNext } from "@/lib/safe-next";
import { LIMITS, clientIp, hit } from "@/lib/rate-limit";

export async function requestMagicLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get("email"));
  if (!email.success) return { error: "Zadejte platný e-mail." };
  // ochrana proti zahlcení schránky a hádání: limit na e-mail i na IP adresu
  const ip = await clientIp();
  const okIp = await hit(`ml:ip:${ip}`, LIMITS.magicLinkPerIp.limit, LIMITS.magicLinkPerIp.windowSec);
  const okEmail = await hit(`ml:email:${email.data}`, LIMITS.magicLinkPerEmail.limit, LIMITS.magicLinkPerEmail.windowSec);
  if (!okIp || !okEmail) return { error: "Příliš mnoho pokusů o přihlášení. Počkejte prosím 15 minut a zkuste to znovu." };
  const redirectTo = safeNext(String(fd.get("next") || ""));
  // signIn odešle e-mail a přesměruje na /login/check (vyhazuje NEXT_REDIRECT)
  await signIn("email", { email: email.data, redirectTo });
  return { ok: true };
}
