import { useEffect, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd } from "../lib/currency";
import { useAuthUser } from "../components/useAuthUser";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  created: string;
}

interface Balance {
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  credit: number;
}

interface Sale {
  id: string;
  sale_id: string;
  customer: string;
  total: number;
  amount_paid: number;
  amount_outstanding: number;
  status: string;
  created: string;
}

interface Payment {
  id: string;
  payment_id: string;
  customer: string;
  amount: number;
  currency: string;
  amount_usd: number;
  payment_method: string;
  created: string;
}

export function CustomersPage() {
  const user = useAuthUser();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [selected, setSelected] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });

  const load = useCallback(async () => {
    const pb = getPb();
    const list = await pb.collection("customers").getFullList<Customer>({ sort: "name" });
    setCustomers(list);
    // Fetch balances in parallel
    const balMap: Record<string, Balance> = {};
    await Promise.all(list.map(async (c) => {
      try {
        const r = await fetch(`${pb.baseUrl}/api/dahav/customers/${c.id}/balance`);
        if (r.ok) balMap[c.id] = await r.json();
      } catch { /* skip */ }
    }));
    setBalances(balMap);
  }, []);

  useEffect(() => { load().catch((e) => setError("Failed to load customers: " + e.message)); }, [load]);

  const openCustomer = async (c: Customer) => {
    setSelected(c);
    const pb = getPb();
    const [s, p] = await Promise.all([
      pb.collection("sales").getFullList<Sale>({ filter: `customer = '${c.id}'`, sort: "-created" }),
      pb.collection("payments").getFullList<Payment>({ filter: `customer = '${c.id}'`, sort: "-created" }),
    ]);
    setSales(s);
    setPayments(p);
  };

  const canCreate = user?.role === "cashier" || user?.role === "manager" || user?.role === "owner";

  const createCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const pb = getPb();
    try {
      await pb.collection("customers").create({ ...form });
      await load();
      setShowForm(false);
      setForm({ name: "", phone: "", email: "", address: "" });
      setSuccess("Customer created");
    } catch (err) {
      setError("Create failed: " + (err as Error).message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Customers</h1>
        {canCreate && <button className="btn primary small" onClick={() => setShowForm(true)}>+ New Customer</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="grid auto-fit" style={{ gap: 16 }}>
        <div className="card table-wrap">
          <table className="customers-table">
            <thead><tr><th>Name</th><th>Phone</th><th>Purchases</th><th>Paid</th><th>Outstanding</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => {
                const b = balances[c.id];
                return (
                  <tr key={c.id} onClick={() => openCustomer(c)} style={{ cursor: "pointer" }}>
                    <td>{c.name}</td>
                    <td className="muted">{c.phone || "—"}</td>
                    <td className="money-usd">{b ? usd(b.total_purchases) : "…"}</td>
                    <td className="money-usd">{b ? usd(b.total_paid) : "…"}</td>
                    <td className="money-usd">
                      {b && b.outstanding > 0 ? <span className="badge red">{usd(b.outstanding)}</span> : b ? <span className="badge green">0</span> : "…"}
                    </td>
                    <td className="no-print">
                      {user?.role === "owner" && (
                        <button
                          className="btn small danger"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm(`Delete customer "${c.name}"? Their sales will be kept (unlinked) and payment records removed.`)) return;
                            const r = await api(`/api/dahav/records/customers/${c.id}`, { method: "DELETE" });
                            if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); return; }
                            setSuccess(`Customer "${c.name}" deleted`);
                            await load();
                          }}
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 size={14} style={{ verticalAlign: "-2px" }} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {customers.length === 0 && <tr><td colSpan={6} className="empty">No customers yet</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p className="muted small">{selected.phone || ""} {selected.email ? "· " + selected.email : ""}</p>
              <div className="grid cols-3" style={{ margin: "14px 0" }}>
                <div className="stat"><div className="stat-label">Purchases</div><div className="stat-value">{usd(sales.reduce((s, x) => s + x.total, 0))}</div></div>
                <div className="stat"><div className="stat-label">Paid</div><div className="stat-value">{usd(payments.reduce((s, x) => s + x.amount_usd, 0))}</div></div>
                <div className="stat"><div className="stat-label">Outstanding</div><div className="stat-value">{usd(sales.reduce((s, x) => s + x.amount_outstanding, 0))}</div></div>
              </div>

              <h3>Sales History</h3>
              <div className="table-wrap" style={{ maxHeight: 200, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Sale ID</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Status</th><th>Date</th></tr></thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td className="muted">{s.sale_id}</td>
                        <td className="money-usd">{usd(s.total)}</td>
                        <td className="money-usd">{usd(s.amount_paid)}</td>
                        <td className="money-usd">{usd(s.amount_outstanding)}</td>
                        <td><span className={`badge ${s.status === "completed" ? "green" : "yellow"}`}>{s.status}</span></td>
                        <td className="muted">{new Date(s.created).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {sales.length === 0 && <tr><td colSpan={6} className="empty">No sales</td></tr>}
                  </tbody>
                </table>
              </div>

              <h3>Payment History</h3>
              <div className="table-wrap" style={{ maxHeight: 200, overflowY: "auto" }}>
                <table>
                  <thead><tr><th>Payment ID</th><th>Amount</th><th>Currency</th><th>USD</th><th>Method</th><th>Date</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="muted">{p.payment_id}</td>
                        <td>{p.amount.toLocaleString()} {p.currency}</td>
                        <td>{p.currency}</td>
                        <td className="money-usd">{usd(p.amount_usd)}</td>
                        <td>{p.payment_method}</td>
                        <td className="muted">{new Date(p.created).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {payments.length === 0 && <tr><td colSpan={6} className="empty">No payments</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty">Select a customer to see balances, sales, and payment history.</div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Customer</h2>
            <form onSubmit={createCustomer}>
              <label>Name <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <div className="grid cols-2">
                <label>Phone <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                <label>Email <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              </div>
              <label>Address <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
