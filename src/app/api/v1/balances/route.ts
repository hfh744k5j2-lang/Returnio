import { api, dateParam, searchParam } from "@/lib/api";
import { getBalances } from "@/lib/services/balance";

export const GET = api(async (ctx, req) => {
  const { rows } = await getBalances(ctx, { partnershipId: searchParam(req, "partner"), asOf: dateParam(req, "asOf") });
  return { items: rows };
});
