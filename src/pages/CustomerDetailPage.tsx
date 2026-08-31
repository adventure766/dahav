import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd } from "../lib/currency";
import { CardSkeleton, SectionError, EmptyState } from "../components/Feedback";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  created: string;
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const pb = getPb();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<{ total_purchases: number; total_paid: number; outstanding: number; credit: number } | null>(null);
  const [sales, setSales] = useState<Array<{ id: string; sale_id: string; total: number; amount_paid: number; amount_outstanding: number; status: string; created: string }>>([]);
  const [payments, setPayments] = useState<Array<{ id: string; payment_id: string; amount: number; currency: string; amount_usd: number; created: string }>>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const c = await pb.collection("customers").getOne<Customer>(id!);
        setCustomer(c);
        const bal = await fetch(`${pb.baseUrl}/api/dahav/customers/${c.id}/balance`).then((r) => r.json());
        setBalance(bal);
        const [s, p] = await Promise.all([
          pb.collection("sales").getFullList<{ id: string; sale_id: string; total: number; amount_paid: number; amount_outstanding: number; status: string; created: string }>({ filter: `customer = '${c.id}'`, sort: "-created" }),
          pb.collection("payments").getFullList<{ id: string; payment_id: string; amount: number; currency: string; amount_usd: number; created: string }>({ filter: `customer = '${c.id}'`, sort: "-created" }),
        ]);
        setSales(s);
        setPayments(p);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, pb]);

  if (loading) return <CardSkeleton rows={5} />;
  if (error || !customer) return <SectionError message="Unable to load customer." onRetry={() => window.location.reload()} />;

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/customers" className="btn small ghost" style={{ marginRight: 8 }}><ArrowLeft size={14} style={{ verticalAlign: "-2px" }} /> Back</Link>
          <h1 style={{ display: "inline-block", margin: 0 }}>{customer.name}</h1>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat-card"><div className="stat-label">Total Purchases</div><div className="stat-value">{usd(balance?.total_purchases ?? 0)}</div></div>
        <div className="card stat-card"><div className="stat-label">Total Paid</div><div className="stat-value">{usd(balance?.total_paid ?? 0)}</div></div>
        <div className="card stat-card">
          <div className="stat-label">Outstanding</div>
          <div className={`stat-value ${balance && balance.outstanding > 0 ? "danger" : "good"}`}>{usd(balance?.outstanding ?? 0)}</div>
          {balance && balance.credit > 0 && <div className="muted small">Credit: {usd(balance.credit)}</div>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Contact</h3>
        <div className="detail-grid">
          <span>Phone</span><span>{customer.phone || "—"}</span>
          <span>Email</span><span>{customer.email || "—"}</span>
          <span>Address</span><span>{customer.address || "—"}</span>
          <span>Customer Since</span><span>{new Date(customer.created).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Sales History</h3>
        {sales.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Sale</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/sales/${encodeURIComponent(s.sale_id)}`}><code>{s.sale_id}</code></Link></td>
                    <td className="money-usd">{usd(s.total)}</td>
                    <td className="money-usd">{usd(s.amount_paid)}</td>
                    <td className="money-usd">{s.amount_outstanding > 0 ? usd(s.amount_outstanding) : "—"}</td>
                    <td><span className={`badge ${s.status === "completed" ? "green" : "yellow"}`}>{s.status}</span></td>
                    <td className="muted">{new Date(s.created).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No sales for this customer." />
        )}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        {payments.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Payment</th><th>Amount</th><th>Currency</th><th>USD</th><th>Date</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.payment_id}</code></td>
                    <td>{p.amount.toLocaleString()} {p.currency}</td>
                    <td>{p.currency}</td>
                    <td className="money-usd">{usd(p.amount_usd)}</td>
                    <td className="muted">{new Date(p.created).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payments for this customer." />
        )}
      </div>
    </div>
  );
}
