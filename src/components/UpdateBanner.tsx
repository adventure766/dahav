import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import {
  APP_VERSION,
  getStatus,
  requestApply,
  waitForHealth,
  clearCachesAndReload,
  type UpdateStatus,
} from "../lib/updater";

/**
 * DAHAV update banner.
 *
 * Polls the local supervisor (127.0.0.1:8091) for update availability and
 * shows a non-intrusive banner with [Update Now] / [Later]. Applying the
 * update restarts the local PocketBase for a few seconds; afterwards the
 * service-worker caches are cleared and the page reloads onto the new build.
 *
 * When no supervisor is reachable (dev mode, LAN access) this renders nothing.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    if (s?.applyResult?.rolledBack) {
      setError(`Update failed and was rolled back: ${s.applyResult.error || "unknown error"}`);
    } else if (s?.applyResult?.ok) {
      setError("");
    }
  }, []);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 5 * 60 * 1000); // every 5 minutes
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  const onUpdateNow = useCallback(async () => {
    setWorking(true);
    setError("");
    try {
      const res = await requestApply();
      if (!res) {
        setError("Could not reach the DAHAV updater. Make sure DAHAV was started from DAHAV.bat.");
        setWorking(false);
        return;
      }
      if (res.ok) {
        // PocketBase is restarting; wait for health, then clear SW caches and reload.
        await waitForHealth();
        await clearCachesAndReload();
        return; // reloading
      }
      setError(res.error || "Update failed. Your current version is unchanged.");
    } catch (e) {
      setError(String(e));
    }
    setWorking(false);
  }, []);

  if (!status?.hasUpdate || dismissed || working) {
    if (!working) {
      // While applying, show a full overlay so the user knows what's happening.
      if (status?.applying) {
        return (
          <div className="update-overlay">
            <RefreshCw size={22} className="spin" />
            <strong>Updating DAHAV…</strong>
            <span>Please wait, this takes a few seconds.</span>
          </div>
        );
      }
      return null;
    }
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-icon"><RefreshCw size={16} /></div>
      <div className="update-banner-body">
        <strong>DAHAV update available</strong>
        <span>
          Current version {APP_VERSION} → New version {status?.latest || "?"}
          {status?.force ? " (required)" : ""}
        </span>
        {status?.notes ? <span className="update-banner-notes">{status.notes}</span> : null}
        {error && <span className="update-banner-error">{error}</span>}
      </div>
      <div className="update-banner-actions">
        <button className="btn primary small" onClick={onUpdateNow} disabled={working}>
          {working ? "Updating…" : "Update Now"}
        </button>
        <button className="btn small" onClick={() => { setDismissed(true); setError(""); }} disabled={status?.force}>
          Later
        </button>
      </div>
      {!status?.force && (
        <button
          className="update-banner-close"
          onClick={() => { setDismissed(true); setError(""); }}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
