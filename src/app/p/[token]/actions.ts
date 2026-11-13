"use server";
import { runAction, type ActionState } from "@/lib/actions";
import { invalid } from "@/lib/errors";
import { getT } from "@/lib/i18n/server";
import { actOnPartnerLink } from "@/lib/services/movements";
import { hashToken } from "@/lib/tokens";
import { LIMITS, clientIp, enforce } from "@/lib/rate-limit";

function payload(fd: FormData) {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    throw invalid("Neplatná data formuláře.");
  }
}

async function run(fd: FormData, action: "confirm" | "dispute" | "accept" | "counter") {
  const { t } = await getT();
  return runAction(async () => {
    const token = String(fd.get("token") ?? "");
    // veřejná stránka bez přihlášení: limit na IP i na odkaz
    await enforce(`pl:ip:${await clientIp()}`, LIMITS.partnerLinkPerIp.limit, LIMITS.partnerLinkPerIp.windowSec);
    await enforce(`pl:token:${hashToken(token)}`, LIMITS.partnerLinkPerToken.limit, LIMITS.partnerLinkPerToken.windowSec);
    const name = String(fd.get("name") ?? "");
    const body = action === "dispute" || action === "counter" ? payload(fd) : {};
    await actOnPartnerLink(token, action, { name, ...body });
    return { ok: true, message: t(`partnerLink.done.${action}`) };
  });
}

export async function confirmLink(_p: ActionState, fd: FormData) {
  return run(fd, "confirm");
}
export async function disputeLink(_p: ActionState, fd: FormData) {
  return run(fd, "dispute");
}
export async function acceptLink(_p: ActionState, fd: FormData) {
  return run(fd, "accept");
}
export async function counterLink(_p: ActionState, fd: FormData) {
  return run(fd, "counter");
}
