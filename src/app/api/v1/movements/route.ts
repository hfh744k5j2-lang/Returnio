import { api, dateParam, enumParam, jsonBody, searchParam } from "@/lib/api";
import { createMovement, listMovements, MOVEMENT_KINDS } from "@/lib/services/movements";

export const GET = api(async (ctx, req) =>
  listMovements(ctx, {
    partnershipId: searchParam(req, "partner"),
    status: enumParam(req, "status", ["PROPOSED", "CONFIRMED", "DISPUTED", "CANCELLED"] as const),
    kind: enumParam(req, "kind", MOVEMENT_KINDS),
    awaiting: enumParam(req, "awaiting", ["me", "partner", "dispute"] as const),
    from: dateParam(req, "from"),
    to: dateParam(req, "to"),
    q: searchParam(req, "q"),
    page: Number(searchParam(req, "page") ?? 1) || 1,
  }),
);

export const POST = api(async (ctx, req) => {
  const m = await createMovement(ctx, await jsonBody(req));
  return { id: m.id, number: m.number };
});
