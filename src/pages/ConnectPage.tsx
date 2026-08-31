import { useState } from "react";
import { connectTo } from "../lib/pb";

export function ConnectPage({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const v = await connectTo(url);
    setBusy(false);
    if (!v.ok) {
      setError(v.error || "Connection failed");
      return;
    }
    onConnected();
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Connect to DAHAV</h1>
        <p className="muted">We couldn't find a DAHAV server automatically. Enter its address.</p>
        <label>
          Server URL
          <input
            type="url"
            placeholder="http://192.168.0.102:8090"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Checking…" : "Connect"}
        </button>

        <details className="help-box">
          <summary>How to find the server address (Windows)</summary>
          <ol>
            <li>Open PowerShell</li>
            <li>Type <code>ipconfig</code></li>
            <li>Find <strong>Wireless LAN adapter Wi-Fi → IPv4 Address</strong></li>
            <li>If PocketBase runs on port 8090, enter <code>http://&lt;that-ip&gt;:8090</code></li>
          </ol>
          <p className="muted small">
            Do NOT use <code>127.0.0.1</code> or <code>localhost</code> when connecting from a phone or another device.
          </p>
        </details>
      </form>
    </div>
  );
}
