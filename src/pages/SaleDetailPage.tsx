import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd, rateLabel } from "../lib/currency";
import { CardSkeleton, SectionError, EmptyState } from "../components/Feedback";

interface SaleDetail {
  id: string;
  sale_id: string;
  transaction: string;
  customer: string;
  cashier: string;
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  amount_paid: number;
  amount_outstanding: number;
  exchange_rate: number;
  payment_method: string;
  created: string;
}

interface SaleItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
  cogs: number;
  fifo_breakdown: Array<{ quantity: number; unit_cost: number }> | string;
}

export function SaleDetailPage() {
  const { id } = useParams();
  const pb = getPb();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [txnId, setTxnId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [cashierName, setCashierName] = useState("");
  const [payments, setPayments] = useState<Array<{ payment_id: string; amount: number; currency: string; amount_usd: number; payment_method: string; created: string }>>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rec = await pb.collection("sales").getFirstListItem<SaleDetail>(`sale_id = '${id}'`);
        setSale(rec);
        const [it, txn, pays] = await Promise.all([
          pb.collection("sale_items").getFullList<SaleItem>({ filter: `sale = '${rec.id}'` }),
          rec.transaction ? pb.collection("transactions").getOne(rec.transaction).catch(() => null) : Promise.resolve(null),
          pb.collection("payments").getFullList<{ payment_id: string; amount: number; currency: string; amount_usd: number; payment_method: string; created: string }>({ filter: `sale = '${rec.id}'`, sort: "-created" }),
        ]);
        setItems(it);
        if (txn) setTxnId(txn.transaction_id);
        if (rec.customer) {
          try { const c = await pb.collection("customers").getOne(rec.customer); setCustomerName(c.name); } catch { /* noop */ }
        }
        if (rec.cashier) {
          try { const u = await pb.collection("users").getOne(rec.cashier); setCashierName(u.name); } catch { /* noop */ }
        }
        setPayments(pays);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, pb]);

  if (loading) return <CardSkeleton rows={6} />;
  if (error || !sale) return <SectionError message="Unable to load sale." onRetry={() => window.location.reload()} />;

  const breakdown = (b: SaleItem["fifo_breakdown"]): Array<{ quantity: number; unit_cost: number }> => {
    if (Array.isArray(b)) return b;
    try { return JSON.parse(String(b)); } catch { return []; }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/sales" className="btn small ghost" style={{ marginRight: 8 }}><ArrowLeft size={14} style={{ verticalAlign: "-2px" }} /> Back</Link>
          <h1 style={{ display: "inline-block", margin: 0 }}>Sale {sale.sale_id}</h1>
        </div>
        <span className={`badge ${sale.status === "completed" ? "green" : "yellow"}`}>{sale.status}</span>
      </div>

      <div className="grid auto-fit" style={{ gap: 14 }}>
        <div className="card">
          <h3>Summary</h3>
          <div className="detail-grid">
            <span>Date</span><span>{new Date(sale.created).toLocaleString()}</span>
            <span>Customer</span><span>{customerName || "Walk-in"}</span>
            <span>Cashier</span><span>{cashierName || "—"}</span>
            <span>Payment Method</span><span className="capitalize">{sale.payment_method || "—"}</span>
            <span>Exchange Rate</span><span>{rateLabel(sale.exchange_rate)}</span>
            <span>Transaction</span>
            <span>{txnId ? <Link to={`/transactions/${encodeURIComponent(txnId)}`}><code>{txnId}</code></Link> : "—"}</span>
          </div>
        </div>
        <div className="card">
          <h3>Totals</h3>
          <div className="totals-row"><span>Subtotal</span><span>{usd(sale.subtotal)}</span></div>
          <div className="totals-row"><span>Discount</span><span>{usd(sale.discount)}</span></div>
          <div className="totals-row grand"><span>Grand Total</span><span>{usd(sale.total)}</span></div>
          <div className="totals-row"><span>Paid</span><span>{usd(sale.amount_paid)}</span></div>
          <div className="totals-row"><span>Outstanding</span><span>{sale.amount_outstanding > 0 ? <span className="badge red">{usd(sale.amount_outstanding)}</span> : "—"}</span></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Items</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th>COGS (FIFO)</th><th>Layers</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.product_name}</td>
                  <td>{i.quantity}</td>
                  <td className="money-usd">{usd(i.unit_price)}</td>
                  <td className="money-usd">{usd(i.line_total)}</td>
                  <td className="money-usd">{usd(i.cogs)}</td>
                  <td className="muted small">
                    {breakdown(i.fifo_breakdown).map((b, idx) => `${b.quantity} × ${usd(b.unit_cost)}${idx < breakdown(i.fifo_breakdown).length - 1 ? " + " : ""}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Payments</h3>
        {payments.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Payment ID</th><th>Amount</th><th>Currency</th><th>USD</th><th>Method</th><th>Date</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td><Link to={`/payments`}><code>{p.payment_id}</code></Link></td>
                    <td>{p.amount.toLocaleString()} {p.currency}</td>
                    <td>{p.currency}</td>
                    <td className="money-usd">{usd(p.amount_usd)}</td>
                    <td className="capitalize">{p.payment_method}</td>
                    <td className="muted">{new Date(p.created).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payments recorded for this sale." />
        )}
      </div>
    </div>
  );
}
