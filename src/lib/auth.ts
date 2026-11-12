import NextAuth from "next-auth";
import type { EmailConfig } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { sendEmail } from "./email";

const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "E-mail",
  from: process.env.EMAIL_FROM || "ObalBook <noreply@example.com>",
  maxAge: 60 * 60, // odkaz platí 1 hodinu
  options: {},
  async sendVerificationRequest({ identifier, url }) {
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
