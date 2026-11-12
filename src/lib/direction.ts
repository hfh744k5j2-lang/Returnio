import type { MovementKind } from "@prisma/client";

/** Klíč překladu pro směr pohybu – u ztráty/poškození/úpravy slovy podle významu, ne „odkud kam“. */
export function directionKey(kind: MovementKind, direction: "IN" | "OUT"): string {
  if (kind === "LOSS" || kind === "DAMAGE" || kind === "CORRECTION") return `movementForm.direction.${kind}.${direction}`;
  return direction === "OUT" ? "movementDetail.out" : "movementDetail.in";
}
