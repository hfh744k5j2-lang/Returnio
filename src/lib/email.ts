import { prisma } from "./db";

export type Mail = { to: string; subject: string; text: string };

function devOutboxEnabled() {
  return process.env.EMAIL_DEV_OUTBOX === "1" || (process.env.NODE_ENV !== "production" && !hasProvider());
}

function hasProvider() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}

/**
 * Odeslání e-mailu. Pořadí: Resend (RESEND_API_KEY) → SMTP (SMTP_URL) → konzole.
 * V dev/test režimu se e-mail navíc uloží do tabulky DevEmail (pro testy a ladění).
 */
export async function sendEmail(mail: Mail): Promise<void> {
  const from = process.env.EMAIL_FROM || "ObalBook <noreply@example.com>";
  if (devOutboxEnabled()) {
    await prisma.devEmail.create({ data: mail });
  }
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
    return;
  }
  if (process.env.SMTP_URL) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    return;
  }
  if (process.env.EMAIL_SILENT === "1") return;
  console.log(`\n[email] To: ${mail.to}\n[email] Subject: ${mail.subject}\n${mail.text}\n`);
}
