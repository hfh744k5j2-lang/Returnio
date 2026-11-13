import { api, dateParam } from "@/lib/api";
import { csvResponse } from "@/lib/csv-response";
import { AppError } from "@/lib/errors";
import { exportPpwrCsv } from "@/lib/services/csv";

export const GET = api(async (ctx, req) => {
  const from = dateParam(req, "from");
  const to = dateParam(req, "to");
  if (!from || !to) throw new AppError("VALIDATION", "Zadejte období (from, to).");
  const n = (v: string | null) => Math.max(0, Number(v) || 0);
  const extra = { pieces: Math.floor(n(req.nextUrl.searchParams.get("extraPieces"))), kg: n(req.nextUrl.searchParams.get("extraKg")) };
  return csvResponse(await exportPpwrCsv(ctx, from, to, extra), `vykaz-ppwr-orientacni-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`);
});
