/**
 * PocketBase client + backend discovery.
 *
 * Primary mechanism: same-origin (window.location.origin).
 * Fallback: saved backend (localStorage) -> manual connect -> validated.
 */
import PocketBase from "pocketbase";

const SAVED_KEY = "dahav_backend_url";

/** The current effective backend base URL. */
export function currentOrigin(): string {
  return window.location.origin;
}

/** Is the app currently being served from PocketBase (same origin)? */
export function isSameOrigin(): boolean {
  // When served from PocketBase, the API is at the origin.
  // During Vite dev, the origin is the dev server, NOT PocketBase.
  return !import.meta.env.DEV;
}

/** Validate that a URL is a real DAHAV server. */
export async function verifyDahavServer(url: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  const clean = String(url).replace(/\/+$/, "");
  try {
    const res = await fetch(`${clean}/api/dahav/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: "Not a valid DAHAV server" };
    const data = await res.json();
    if (data && data.app === "dahav") {
      return { ok: true, version: data.version };
    }
    return { ok: false, error: "Not a valid DAHAV server" };
  } catch (e) {
    return { ok: false, error: "Could not reach server" };
  }
}

let pbInstance: PocketBase | null = null;
let pbBase: string | null = null;

/** Get (or create) the PocketBase client bound to the best available backend. */
export function getPb(): PocketBase {
  if (pbInstance && pbBase) return pbInstance;

  const saved = localStorage.getItem(SAVED_KEY);
  const base = isSameOrigin() ? currentOrigin() : saved || currentOrigin();
  pbBase = base;
  pbInstance = new PocketBase(base);
  return pbInstance;
}

/** Explicitly connect to a backend URL (validated first). */
export async function connectTo(url: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  const v = await verifyDahavServer(url);
  if (!v.ok) return v;
  const clean = String(url).replace(/\/+$/, "");
  localStorage.setItem(SAVED_KEY, clean);
  pbBase = clean;
  pbInstance = new PocketBase(clean);
  return { ok: true, version: v.version };
}

/** Forget the saved backend (used when connection fails). */
export function clearSavedBackend(): void {
  localStorage.removeItem(SAVED_KEY);
}

export { pbBase };
