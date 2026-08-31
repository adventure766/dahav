/**
 * Shared API helper for DAHAV custom endpoints + auth state.
 */
import { getPb } from "./pb";

export type Role = "owner" | "manager" | "cashier" | "employee";

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

/** Auth state held in a simple store. */
export const authState = {
  user: null as StaffUser | null,
  token: null as string | null,
};

export function setAuth(user: StaffUser | null, token: string | null) {
  authState.user = user;
  authState.token = token;
}

export function isAuthed() {
  return !!authState.user && !!authState.token;
}

/** Call a custom DAHAV endpoint with the auth token. */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const pb = getPb();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = pb.authStore.token || authState.token;
  if (token) headers.Authorization = token;
  const res = await fetch(pb.baseUrl + path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data: T;
  try {
    data = await res.json();
  } catch {
    data = undefined as T;
  }
  return { status: res.status, data };
}

/** Login as a staff user. */
export async function login(email: string, password: string) {
  const pb = getPb();
  const res = await pb.collection("users").authWithPassword(email, password);
  const user = res.record as unknown as StaffUser;
  setAuth(user, pb.authStore.token);
  return user;
}

export async function logout() {
  const pb = getPb();
  pb.authStore.clear();
  setAuth(null, null);
}

/** Fetch the default exchange rate + settings. */
export async function fetchDefaultRate() {
  const pb = getPb();
  return pb.send("/api/dahav/rates/default", { method: "GET" });
}
