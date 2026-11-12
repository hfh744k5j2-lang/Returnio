import type { Role } from "@prisma/client";
import { forbidden } from "./errors";

const ALL: Role[] = ["ADMIN", "LOGISTIK", "SKLAD"];
const OFFICE: Role[] = ["ADMIN", "LOGISTIK"];

export const PERMISSIONS = {
  "company.manage": ["ADMIN"],
  "users.manage": ["ADMIN"],
  "partners.view": ALL,
  "partners.manage": OFFICE,
  "packaging.view": ALL,
  "packaging.manage": OFFICE,
  "movements.view": ALL,
  /** Výdej, příjem, vrácení – i skladník. */
  "movements.create": ALL,
  /** Ztráta, poškození, oprava – jen kancelář. */
  "movements.createSpecial": OFFICE,
  "movements.confirm": ALL,
  "movements.dispute": ALL,
  "disputes.resolve": OFFICE,
  "balances.view": ALL,
  "import.run": OFFICE,
  "export.run": OFFICE,
  "reports.view": OFFICE,
  "audit.view": OFFICE,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}

export function assertCan(role: Role, perm: Permission): void {
  if (!can(role, perm)) throw forbidden();
}
