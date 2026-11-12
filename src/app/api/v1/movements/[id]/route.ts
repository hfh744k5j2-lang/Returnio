import { api } from "@/lib/api";
import { getMovement } from "@/lib/services/movements";
import { movementHistory } from "@/lib/services/audit";

export const GET = api<{ id: string }>(async (ctx, _req, { id }) => {
  const movement = await getMovement(ctx, id);
  return { movement, history: await movementHistory(ctx, id) };
});
