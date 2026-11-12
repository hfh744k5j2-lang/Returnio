import { api, jsonBody } from "@/lib/api";
import { createPackagingType, listPackagingTypes } from "@/lib/services/packaging";

export const GET = api(async (ctx, req) => ({
  items: await listPackagingTypes(ctx, { includeInactive: req.nextUrl.searchParams.get("all") === "1" }),
}));

export const POST = api(async (ctx, req) => {
  const t = await createPackagingType(ctx, await jsonBody(req));
  return { id: t.id };
});
