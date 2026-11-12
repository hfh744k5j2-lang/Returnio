import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { runNotifications } from "@/lib/services/notifications";

/** Vercel Cron (GET s hlavičkou Authorization: Bearer CRON_SECRET). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || secret.length < 16 || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stats = await runNotifications();
  return NextResponse.json({ ok: true, ...stats });
}
