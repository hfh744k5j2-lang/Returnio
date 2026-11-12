import { api, jsonBody } from "@/lib/api";
import { invitePartner, listPartners } from "@/lib/services/partners";

export const GET = api(async (ctx) => ({ items: await listPartners(ctx) }));

export const POST = api(async (ctx, req) => {
  const { partnership } = await invitePartner(ctx, await jsonBody(req));
  return { id: partnership.id };
});
