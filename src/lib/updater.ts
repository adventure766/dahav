/**
 * DAHAV update client.
 *
 * The React app never touches the filesystem. It talks to the local DAHAV
 * supervisor (updater.ps1) over HTTP on 127.0.0.1:8091 — the same machine,
 * localhost only. If the supervisor isn't running (e.g. dev mode, or DAHAV
 * reached over the LAN), every function here degrades to a graceful no-op so
 * the app just works as before.
 */
export interface UpdateStatus {
  ok: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  force: boolean;
  notes?: string;
  releaseNotes?: string[];
  staged: boolean;
  applying: boolean;
  applyResult?: { ok: boolean; version?: string; rolledBack?: boolean; error?: string } | null;
  server: { healthy: boolean; port: number };
}

export const APP_VERSION = (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__) || "0.0.0";
const BASE = "http://127.0.0.1:8091";

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 2000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** True when running on the same machine as the launcher (desktop use). */
function helperReachable(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname, protocol } = window.location;
  return (hostname === "localhost" || hostname === "127.0.0.1") && protocol.startsWith("http");
}

export async function getStatus(): Promise<UpdateStatus | null> {
  if (!helperReachable()) return null;
  try {
    const r = await fetchWithTimeout(`${BASE}/status`, {}, 2500);
    if (!r.ok) return null;
    return (await r.json()) as UpdateStatus;
  } catch {
    return null;
  }
}

export async function requestApply(): Promise<{ ok: boolean; version?: string; rolledBack?: boolean; error?: string } | null> {
  if (!helperReachable()) return null;
  try {
    const r = await fetchWithTimeout(`${BASE}/apply`, { method: "POST" }, 5000);
    if (!r.ok) return null;
    return (await r.json()) as { ok: boolean; version?: string; rolledBack?: boolean; error?: string };
  } catch {
    return null;
  }
}

/** Poll the local PocketBase health endpoint until it responds again. */
export async function waitForHealth(timeoutMs = 45000): Promise<boolean> {
  const origin = window.location.origin;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetchWithTimeout(`${origin}/api/dahav/health`, {}, 2000);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

/** Wipe service-worker caches + force-update the SW, then reload. */
export async function clearCachesAndReload(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch {
    /* best effort */
  }
  window.location.reload();
}
