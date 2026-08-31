import { useEffect, useState, useCallback } from "react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { rateLabel } from "../lib/currency";
import { useAuthUser } from "../components/useAuthUser";

interface Settings {
  id: string;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  tax_id: string;
  currency: string;
  default_rate: number;
}

interface RateHistory { id: string; rate: number; note: string; created: string; }

export function SettingsPage() {
  const user = useAuthUser();
  const isOwner = user?.role === "owner";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [form, setForm] = useState({ company_name: "", address: "", phone: "", email: "", tax_id: "", currency: "USD" });
  const [newRate, setNewRate] = useState("");
  const [newUser, setNewUser] = useState({ email: "", password: "", name: "", role: "cashier" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const pb = getPb();
    const [s, r] = await Promise.all([
      pb.collection("settings").getFullList<Settings>(),
      pb.collection("exchange_rates").getFullList<RateHistory>({ sort: "-created" }),
    ]);
    if (s[0]) {
      setSettings(s[0]);
      setForm({ company_name: s[0].company_name || "", address: s[0].address || "", phone: s[0].phone || "", email: s[0].email || "", tax_id: s[0].tax_id || "", currency: s[0].currency || "USD" });
    }
    setRateHistory(r);
  }, []);

  useEffect(() => { load().catch((e) => setError("Failed to load settings: " + e.message)); }, [load]);

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setError(""); setSuccess("");
    const pb = getPb();
    try {
      await pb.collection("settings").update(settings.id, { ...form });
      setSuccess("Company settings saved");
      await load();
    } catch (err) {
      setError("Save failed: " + (err as Error).message);
    }
  };

  const updateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const r = await api("/api/dahav/rates/default", { method: "POST", body: { rate: Number(newRate), note: "Updated in settings" } });
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "Rate update failed"); return; }
    setSuccess(`Default rate updated to ${rateLabel(Number(newRate))}`);
    setNewRate("");
    await load();
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const r = await api("/api/dahav/users/create", { method: "POST", body: newUser });
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "User creation failed"); return; }
    setSuccess(`User created: ${newUser.name} (${newUser.role})`);
    setNewUser({ email: "", password: "", name: "", role: "cashier" });
  };

  return (
    <div>
      <div className="page-head"><h1>Settings</h1></div>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="grid auto-fit" style={{ gap: 16 }}>
        <div className="card">
          <h2>Company Information</h2>
          <p className="muted small">Shown on every report and receipt.</p>
          <form onSubmit={saveCompany}>
            <label>Company Name <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></label>
            <label>Address <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <div className="grid cols-2">
              <label>Phone <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>Email <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            </div>
            <label>Tax / Business ID <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} /></label>
            <div className="modal-actions">
              <button type="submit" className="btn primary" disabled={!isOwner}>Save</button>
            </div>
          </form>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Exchange Rate</h2>
            <p className="muted small">Default: 1 USD = X SSP. Every transaction can override this.</p>
            {settings && <p>Current default: <strong>{rateLabel(settings.default_rate)}</strong></p>}
            <form onSubmit={updateRate} className="grid inline-form-row" style={{ gap: 8 }}>
              <input type="number" step="any" min="0.0001" placeholder="e.g. 8000" value={newRate} onChange={(e) => setNewRate(e.target.value)} required />
              <button type="submit" className="btn primary" disabled={!isOwner}>Update</button>
            </form>
            <h3 style={{ marginTop: 16, fontSize: 15 }}>Rate History</h3>
            <div className="table-wrap" style={{ maxHeight: 160, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Rate</th><th>Note</th><th>Date</th></tr></thead>
                <tbody>
                  {rateHistory.map((r) => (
                    <tr key={r.id}>
                      <td>{rateLabel(r.rate)}</td>
                      <td className="muted">{r.note}</td>
                      <td className="muted">{new Date(r.created).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {rateHistory.length === 0 && <tr><td colSpan={3} className="empty">No rate changes yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Add User</h2>
            <p className="muted small">Owner only. Roles control access to reports, payroll, and settings.</p>
            <form onSubmit={createUser}>
              <label>Name <input required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></label>
              <label>Email <input type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></label>
              <label>Password (min 8) <input type="password" minLength={8} required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></label>
              <label>Role
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="cashier">Cashier</option>
                  <option value="employee">Employee</option>
                </select>
              </label>
              <div className="modal-actions">
                <button type="submit" className="btn primary" disabled={!isOwner}>Create User</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
