import NextAuth from "next-auth";
import type { EmailConfig } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { sendEmail } from "./email";
import { appUrl } from "./tokens";
import { LIMITS, hit } from "./rate-limit";

export function rebaseToAppUrl(raw: string): string {
  const u = new URL(raw);
  return appUrl(u.pathname + u.search);
}

const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "E-mail",
  from: process.env.EMAIL_FROM || "ObalBook <noreply@example.com>",
  maxAge: 60 * 60, // odkaz platí 1 hodinu
  options: {},
  async sendVerificationRequest({ identifier, url: rawUrl }) {
    // Odkaz vždy na APP_URL – nikdy podle hlavičky Host/X-Forwarded-Host požadavku (ochrana proti podvržení).
    const url = rebaseToAppUrl(rawUrl);
    // pojistka i pro přímé volání Auth.js mimo formulář: nad limit se e-mail tiše neodešle
    const { limit, windowSec } = LIMITS.magicLinkSendPerEmail;
    if (!(await hit(`ml-send:${identifier.toLowerCase()}`, limit, windowSec))) {
      console.warn("Magic link: překročen limit odeslání, e-mail neodeslán.");
      return;
    }
    await sendEmail({
      to: identifier,
      subject: "Přihlášení do ObalBook / Sign in to ObalBook",
      text:
        `Pro přihlášení klikněte na odkaz (platí 1 hodinu):\n${url}\n\n` +
        `To sign in, open this link (valid for 1 hour):\n${url}\n\n` +
        `Pokud jste o přihlášení nežádali, e-mail ignorujte.`,
    });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  providers: [emailProvider],
  pages: { signIn: "/login", verifyRequest: "/login/check", error: "/login" },
  trustHost: true,
});
