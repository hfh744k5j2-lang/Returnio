import { api } from "@/lib/api";
import { getCompany } from "@/lib/services/companies";

export const GET = api(async (ctx) => {
  const company = await getCompany(ctx);
  return { user: { id: ctx.userId, email: ctx.email, role: ctx.role }, company: { id: company.id, name: company.name } };
});
