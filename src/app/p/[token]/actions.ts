"use server";
import { runAction, type ActionState } from "@/lib/actions";
import { invalid } from "@/lib/errors";
import { actOnPartnerLink } from "@/lib/services/movements";

function payload(fd: FormData) {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    throw invalid("Neplatná data formuláře.");
  }
}

async function run(fd: FormData, action: "confirm" | "dispute" | "accept" | "counter", message: string) {
  return runAction(async () => {
    const token = String(fd.get("token") ?? "");
    const name = String(fd.get("name") ?? "");
    const body = action === "dispute" || action === "counter" ? payload(fd) : {};
    await actOnPartnerLink(token, action, { name, ...body });
    return { ok: true, message };
  });
}

export async function confirmLink(_p: ActionState, fd: FormData) {
  return run(fd, "confirm", "Děkujeme, pohyb je potvrzen. / Thank you, the movement is confirmed.");
}
export async function disputeLink(_p: ActionState, fd: FormData) {
  return run(fd, "dispute", "Rozpor jsme odeslali. Partner se vám ozve. / The dispute has been sent.");
}
export async function acceptLink(_p: ActionState, fd: FormData) {
  return run(fd, "accept", "Děkujeme, oprava je přijata a pohyb potvrzen. / Thank you, the correction is accepted.");
}
export async function counterLink(_p: ActionState, fd: FormData) {
  return run(fd, "counter", "Váš návrh jsme odeslali. / Your proposal has been sent.");
}
