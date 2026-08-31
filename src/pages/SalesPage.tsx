import { useEffect, useState, useCallback } from "react";
import { Search, Trash2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd } from "../lib/currency";
import { api } from "../lib/api";
import { Pagination, SortHeader } from "../components/Pagination";
import { CardSkeleton, SectionError, EmptyState } from "../components/Feedback";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuthUser } from "../components/useAuthUser";
import { Link } from "react-router-dom";

interface Sale {
  id: string;
  sale_id: string;
  transaction: string;
  customer: string;
  cashier: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  amount_outstanding: number;
  status: string;
  original_currency: string;
  exchange_rate: number;
  amount_usd: number;
  payment_method: string;
  created: string;
}

interface SaleItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cogs: number;
}

interface Txn { id: string; transaction_id: string; type: string; }

const PAGE_SIZE = 12;

export function SalesPage() {
  const user = useAuthUser();
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Sale | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [txn, setTxn] = useState<Txn | null>(null);
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payCurrency, setPayCurrency] = useState<"USD" | "SSP">("USD");
  const [confirmDelete, setConfirmDelete] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);

  // List controls
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState("-created");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const pb = getPb();
    try {
      const filterParts: string[] = [];
      if (statusFilter) filterParts.push(`status = '${statusFilter}'`);
      if (search) filterParts.push(`sale_id ~ '${search}'`);
      const filter = filterParts.join(" && ");
      const list = await pb.collection("sales").getList<Sale>(page, PAGE_SIZE, {
        sort,
        ...(filter ? { filter } : {}),
      });
      setSales(list.items);
      setTotal(list.totalItems);
      const [c, u] = await Promise.all([
        pb.collection("customers").getFullList<{ id: string; name: string }>(),
        pb.collection("users").getFullList<{ id: string; name: string }>(),
      ]);
      setCustomers(Object.fromEntries(c.map((x) => [x.id, x.name])));
      setUsers(Object.fromEntries(u.map((x) => [x.id, x.name])));
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, sort, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const openSale = async (sale: Sale) => {
    setSelected(sale);
    setPayAmount("");
    const pb = getPb();
    const [it, t] = await Promise.all([
      pb.collection("sale_items").getFullList<SaleItem>({ filter: `sale = '${sale.id}'` }),
      sale.transaction ? pb.collection("transactions").getOne<Txn>(sale.transaction).catch(() => null) : Promise.resolve(null),
    ]);
    setItems(it);
    setTxn(t);
  };

  const applyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(false); setSuccess("");
    const r = await api("/api/dahav/payments/on-sale", {
      method: "POST",
      body: { sale_id: selected.sale_id, amount: Number(payAmount), currency: payCurrency, payment_method: "cash" },
    });
    if (r.status !== 200) { setError(true); return; }
    setSuccess("Payment applied");
    await load();
    const updated = sales.find((s) => s.sale_id === selected.sale_id);
    if (updated) await openSale(updated);
  };

  const canDelete = user?.role === "owner";

  const doDeleteSale = async () => {
    if (!confirmDelete) return;
    setDeleting(true); setError(false); setSuccess("");
    const r = await api(`/api/dahav/records/sales/${confirmDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.status !== 200) {
      setError(true);
      setConfirmDelete(null);
      return;
    }
    setSuccess(`Sale ${confirmDelete.sale_id} deleted`);
    setSelected(null);
    setConfirmDelete(null);
    await load();
  };

  return (
    <div>
      <div className="page-head"><h1>Sales</h1></div>
      {success && <div className="alert success">{success}</div>}

      <div className="list-toolbar">
        <div className="search-box">
          <Search size={15} className="muted" />
          <input placeholder="Search sale ID…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="partial">Partial</option>
          <option value="credit">Credit</option>
          <option value="void">Void</option>
        </select>
      </div>

      <div className="grid master-detail">
        <div className="card table-wrap">
          {loading ? (
            <CardSkeleton rows={6} />
          ) : error ? (
            <SectionError message="Unable to load sales data." onRetry={load} />
          ) : sales.length === 0 ? (
            <EmptyState title={search || statusFilter ? "No sales match your filters." : "No sales recorded yet."} action="New Sale" onAction={() => (window.location.href = "/pos")} />
          ) : (
            <table className="sales-table">
              <thead>
                <tr>
                  <SortHeader label="Sale" k="sale_id" sort={sort} onSort={(k) => { setSort(sort.includes(k) && !sort.startsWith("-") ? `-${k}` : k); setPage(1); }} />
                  <th>Customer</th>
                  <SortHeader label="Total" k="total" sort={sort} onSort={(k) => { setSort(sort.includes(k) && !sort.startsWith("-") ? `-${k}` : k); setPage(1); }} />
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} onClick={() => openSale(s)} style={{ cursor: "pointer" }}>
                    <td><Link to={`/sales/${encodeURIComponent(s.sale_id)}`} onClick={(e) => e.stopPropagation()}><code>{s.sale_id}</code></Link></td>
                    <td>{s.customer ? customers[s.customer] || "—" : "Walk-in"}</td>
                    <td className="money-usd">{usd(s.total)}</td>
                    <td className="money-usd">{usd(s.amount_paid)}</td>
                    <td className="money-usd">{s.amount_outstanding > 0 ? <span className="badge red">{usd(s.amount_outstanding)}</span> : "—"}</td>
                    <td><span className={`badge ${s.status === "completed" ? "green" : "yellow"}`}>{s.status}</span></td>
                    <td className="muted">{new Date(s.created).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={page} perPage={PAGE_SIZE} total={total} onPage={setPage} />
        </div>

        <div className="card detail-panel">
          {selected ? (
            <>
              <h2>
                <Link to={`/sales/${encodeURIComponent(selected.sale_id)}`}>Sale {selected.sale_id}</Link>
              </h2>
              <p className="muted small">
                {selected.customer ? customers[selected.customer] : "Walk-in"} · {new Date(selected.created).toLocaleString()}
                {" · Cashier: "}{users[selected.cashier] || "—"}
                {txn && <span> · Txn: <Link to={`/transactions/${encodeURIComponent(txn.transaction_id)}`}><code>{txn.transaction_id}</code></Link> ({txn.type})</span>}
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Line</th><th>COGS</th></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.product_name}</td>
                        <td>{i.quantity}</td>
                        <td className="money-usd">{usd(i.unit_price)}</td>
                        <td className="money-usd">{usd(i.line_total)}</td>
                        <td className="money-usd">{usd(i.cogs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="totals-row"><span>Subtotal</span><span>{usd(selected.subtotal)}</span></div>
              <div className="totals-row"><span>Discount</span><span>{usd(selected.discount)}</span></div>
              <div className="totals-row grand"><span>Total</span><span>{usd(selected.total)}</span></div>
              <div className="totals-row"><span>Paid</span><span>{usd(selected.amount_paid)}</span></div>
              <div className="totals-row"><span>Outstanding</span><span>{usd(selected.amount_outstanding)}</span></div>

              {selected.amount_outstanding > 0 && (
                <form onSubmit={applyPayment} className="card" style={{ marginTop: 12 }}>
                  <h3>Apply Payment</h3>
                  <div className="grid cols-2">
                    <label>Amount
                      <input type="number" step="0.01" min="0.01" max={selected.amount_outstanding} required value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)} />
                    </label>
                    <label>Currency
                      <select value={payCurrency} onChange={(e) => setPayCurrency(e.target.value as "USD" | "SSP")}>
                        <option value="USD">USD</option>
                        <option value="SSP">SSP</option>
                      </select>
                    </label>
                  </div>
                  <button className="btn primary block" type="submit">Apply Payment</button>
                </form>
              )}

              {canDelete && (
                <div style={{ marginTop: 12 }}>
                  <button className="btn small danger" onClick={() => setConfirmDelete(selected)}>
                    <Trash2 size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                    Delete Sale
                  </button>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    Deletes the sale, its items, payments, receipt, invoice, and ledger transaction.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="empty">Select a sale to see details, items, and transaction.</div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Sale"
        message={`Delete ${confirmDelete?.sale_id} (${usd(confirmDelete?.total ?? 0)})? This permanently removes the sale, its items, payments, receipt, invoice, and ledger transaction. This cannot be undone.`}
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDeleteSale}
      />
    </div>
  );
}