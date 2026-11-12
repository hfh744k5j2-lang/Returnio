import { api, dateParam, enumParam, searchParam } from "@/lib/api";
import { csvResponse } from "@/lib/csv-response";
import { exportMovementsCsv } from "@/lib/services/csv";
import { MOVEMENT_KINDS } from "@/lib/services/movements";

export const GET = api(async (ctx, req) => {
  const csv = await exportMovementsCsv(ctx, {
    partnershipId: searchParam(req, "partner"),
    status: enumParam(req, "status", ["PROPOSED", "CONFIRMED", "DISPUTED", "CANCELLED"] as const),
    kind: enumParam(req, "kind", MOVEMENT_KINDS),
    awaiting: enumParam(req, "awaiting", ["me", "partner", "dispute"] as const),
    from: dateParam(req, "from"),
    to: dateParam(req, "to"),
    q: searchParam(req, "q"),
  });
  return csvResponse(csv, `pohyby-${new Date().toISOString().slice(0, 10)}.csv`);
});
