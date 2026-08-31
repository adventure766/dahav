import { useEffect, useState, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd, ssp, rateLabel } from "../lib/currency";
import { useAuthUser } from "../components/useAuthUser";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { Currency } from "../lib/engine";

interface Expense {
  id: string;
  expense_id: string;
  transaction: string;
  category: string;
  supplier: string;
  created_by: string;
  description: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  amount_usd: number;
  payment_method: string;
  status: string;
  reference: string;
  expense_date: string;
  created: string;
}

interface Category { id: string; name: string; }
interface Supplier { id: string; name: string; }

export function ExpensesPage() {
  const user = useAuthUser();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    description: "", category: "", supplier: "", amount: "", currency: "SSP" as Currency,
    useCustomRate: false, customRate: "", payment_method: "cash", expense_date: "",
  });

  const load = useCallback(async () => {
    const pb = getPb();
    const [e, c, s] = await Promise.all([
      pb.collection("expenses").getFullList<Expense>({ sort: "-created" }),
      pb.collection("expense_categories").getFullList<Category>({ sort: "name" }),
      pb.collection("suppliers").getFullList<Supplier>({ sort: "name" }),
    ]);
    setExpenses(e);
    setCategories(c);
    setSuppliers(s);
  }, []);

  useEffect(() => { load().catch((e) => setError("Failed to load expenses: " + e.message)); }, [load]);

  const canCreate = user?.role === "manager" || user?.role === "owner";
  const canDelete = user?.role === "owner";

  const openEdit = (ex: Expense) => {
    setEditing(ex);
    setForm({
      description: ex.description || "",
      category: ex.category || "",
      supplier: ex.supplier || "",
      amount: String(ex.amount),
      currency: (ex.currency as Currency) || "SSP",
      useCustomRate: !!ex.exchange_rate,
      customRate: String(ex.exchange_rate || ""),
      payment_method: ex.payment_method || "cash",
      expense_date: (ex.expense_date || "").slice(0, 10),
    });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (editing) {
      const r = await api(`/api/dahav/records/expenses/${editing.id}`, {
        method: "PATCH",
        body: {
          description: form.description,
          category: form.category || undefined,
          supplier: form.supplier || undefined,
          amount: Number(form.amount),
          currency: form.currency,
          exchange_rate: form.useCustomRate ? Number(form.customRate) : undefined,
          payment_method: form.payment_method,
          expense_date: form.expense_date || undefined,
        },
      });
      if (r.status !== 200) { setError((r.data as { error?: string }).error || "Expense update failed"); return; }
      setSuccess("Expense updated");
    } else {
      const r = await api("/api/dahav/expenses/create", {
        method: "POST",
        body: {
          description: form.description,
          category: form.category || undefined,
          supplier: form.supplier || undefined,
          amount: Number(form.amount),
          currency: form.currency,
          exchange_rate: form.useCustomRate ? Number(form.customRate) : undefined,
          payment_method: form.payment_method,
          expense_date: form.expense_date || undefined,
        },
      });
      if (r.status !== 200) { setError((r.data as { error?: string }).error || "Expense creation failed"); return; }
      setSuccess("Expense recorded");
    }
    setShowForm(false);
    setEditing(null);
    setForm({ description: "", category: "", supplier: "", amount: "", currency: "SSP", useCustomRate: false, customRate: "", payment_method: "cash", expense_date: "" });
    await load();
  };

  const doDeleteExpense = async () => {
    if (!confirmDelete) return;
    setDeleting(true); setError(""); setSuccess("");
    const r = await api(`/api/dahav/records/expenses/${confirmDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); setConfirmDelete(null); return; }
    setSuccess(`Expense ${confirmDelete.expense_id} deleted`);
    setConfirmDelete(null);
    await load();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Expenses</h1>
        {canCreate && <button className="btn primary small" onClick={() => setShowForm(true)}>+ New Expense</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="card table-wrap">
        <table className="expenses-table">
          <thead>
            <tr>
              <th>ID</th><th>Description</th><th>Category</th><th>Amount</th><th>Currency</th>
              <th>Rate</th><th>USD</th><th>Method</th><th>Date</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((ex) => (
              <tr key={ex.id}>
                <td className="muted">{ex.expense_id}</td>
                <td>{ex.description || "—"}</td>
                <td>{categories.find((c) => c.id === ex.category)?.name || "—"}</td>
                <td className={ex.currency === "SSP" ? "money-ssp" : "money-usd"}>{ex.currency === "SSP" ? ssp(ex.amount) : usd(ex.amount)}</td>
                <td>{ex.currency}</td>
                <td className="muted">{rateLabel(ex.exchange_rate)}</td>
                <td className="money-usd">{usd(ex.amount_usd)}</td>
                <td className="capitalize">{ex.payment_method}</td>
                <td className="muted">{new Date(ex.expense_date || ex.created).toLocaleDateString()}</td>
                <td><span className="badge gray">{ex.status}</span></td>
                <td className="no-print">
                  <button className="btn small" onClick={() => openEdit(ex)} aria-label={`Edit ${ex.expense_id}`}><Pencil size={14} style={{ verticalAlign: "-2px" }} /></button>{" "}
                  {canDelete && (
                    <button className="btn small danger" onClick={() => setConfirmDelete(ex)} aria-label={`Delete ${ex.expense_id}`}><Trash2 size={14} style={{ verticalAlign: "-2px" }} /></button>
                  )}
                </td>
              </tr>
            ))}
            {expenses.length === 0 && <tr><td colSpan={11} className="empty">No expenses recorded</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditing(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? `Edit Expense — ${editing.expense_id}` : "New Expense"}</h2>
            <form onSubmit={submit}>
              <label>Description <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <div className="grid cols-2">
                <label>Category
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    <option value="">— select —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label>Supplier
                  <select value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })}>
                    <option value="">— none —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid cols-2">
                <label>Amount <input type="number" step="0.01" min="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
                <label>Currency
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
                    <option value="USD">USD</option>
                    <option value="SSP">SSP</option>
                  </select>
                </label>
              </div>
              <label className="rate-toggle" style={{ margin: "8px 0" }}>
                <input type="checkbox" checked={form.useCustomRate} onChange={(e) => setForm({ ...form, useCustomRate: e.target.checked })} />
                Use custom exchange rate
              </label>
              {form.useCustomRate && (
                <label>Exchange Rate (1 USD = X SSP)
                  <input type="number" step="any" min="0.0001" value={form.customRate} onChange={(e) => setForm({ ...form, customRate: e.target.value })} required />
                </label>
              )}
              <div className="grid cols-2">
                <label>Payment Method
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="mobile_money">Mobile Money</option>
                    <option value="card">Card</option>
                    <option value="credit">Credit</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>Date <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
                <button type="submit" className="btn primary">{editing ? "Save Changes" : "Save Expense"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Expense"
        message={`Delete expense ${confirmDelete?.expense_id} (${usd(confirmDelete?.amount_usd ?? 0)})? This also removes its ledger transaction. This cannot be undone.`}
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDeleteExpense}
      />
    </div>
  );
}
