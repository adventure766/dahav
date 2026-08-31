import { authState } from "../lib/api";
import type { StaffUser } from "../lib/api";

/** Hook that returns the current authenticated user (reactive to auth changes). */
export function useAuthUser(): StaffUser | null {
  return authState.user;
}
