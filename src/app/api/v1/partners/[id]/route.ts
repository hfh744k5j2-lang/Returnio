import { api, jsonBody } from "@/lib/api";
import { getPartner, updatePartner } from "@/lib/services/partners";
import { listTypesForPartnership } from "@/lib/services/packaging";

export const GET = api<{ id: string }>(async (ctx, _req, { id }) => {
  const partner = await getPartner(ctx, id);
  const types = await listTypesForPartnership(ctx, id);
  return {
    partner,
    packagingTypes: types.map((t) => ({ id: t.id, code: t.code, name: t.name, owner: t.company.name })),
  };
});

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => {
  await updatePartner(ctx, id, await jsonBody(req));
  return { ok: true };
});
