import { api, searchParam } from "@/lib/api";
import { listAudit } from "@/lib/services/audit";

export const GET = api(async (ctx, req) =>
  listAudit(ctx, {
    entityType: searchParam(req, "entityType"),
    entityId: searchParam(req, "entityId"),
    page: Number(searchParam(req, "page") ?? 1) || 1,
  }),
);
