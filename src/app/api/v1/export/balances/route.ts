import { api, dateParam, searchParam } from "@/lib/api";
import { csvResponse } from "@/lib/csv-response";
import { exportBalancesCsv } from "@/lib/services/csv";

export const GET = api(async (ctx, req) => {
  const csv = await exportBalancesCsv(ctx, { partnershipId: searchParam(req, "partner"), asOf: dateParam(req, "asOf") });
  return csvResponse(csv, `saldo-${new Date().toISOString().slice(0, 10)}.csv`);
});
