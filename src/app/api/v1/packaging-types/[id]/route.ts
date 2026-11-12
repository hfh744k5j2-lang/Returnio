import { api, jsonBody } from "@/lib/api";
import { getPackagingType, updatePackagingType } from "@/lib/services/packaging";

export const GET = api<{ id: string }>(async (ctx, _req, { id }) => getPackagingType(ctx, id));

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => {
  await updatePackagingType(ctx, id, await jsonBody(req));
  return { ok: true };
});
