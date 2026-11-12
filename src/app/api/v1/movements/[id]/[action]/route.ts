import { api, jsonBody } from "@/lib/api";
import { notFound } from "@/lib/errors";
import {
  acceptCorrection,
  cancelMovement,
  confirmMovement,
  counterCorrection,
  disputeMovement,
} from "@/lib/services/movements";

export const POST = api<{ id: string; action: string }>(async (ctx, req, { id, action }) => {
  switch (action) {
    case "confirm":
      await confirmMovement(ctx, id);
      break;
    case "dispute":
      await disputeMovement(ctx, id, await jsonBody(req));
      break;
    case "accept":
      await acceptCorrection(ctx, id);
      break;
    case "counter":
      await counterCorrection(ctx, id, await jsonBody(req));
      break;
    case "cancel":
      await cancelMovement(ctx, id);
      break;
    default:
      throw notFound("Akce");
  }
  return { ok: true };
});
