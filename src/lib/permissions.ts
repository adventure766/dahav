/**
 * Frontend permission helper — mirrors pb_hooks/lib/constants.cjs.
 */
import { ROLES, PERMISSIONS } from "./roles";

export type Role = keyof typeof ROLES;

export function roleRank(role: Role | string): number {
  const r: Record<string, number> = { owner: 4, manager: 3, cashier: 2, employee: 1 };
  return r[role] || 0;
}

export function can(role: Role | string, permission: string): boolean {
  const needed = (PERMISSIONS as Record<string, string>)[permission];
  if (!needed) return false;
  return roleRank(role) >= roleRank(needed);
}
