import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd, rateLabel } from "../lib/currency";
import { CardSkeleton, SectionError, EmptyState } from "../components/Feedback";

interface Txn {
  id: string;
  transaction_id: string;
  type: string;
  date: string;
  original_amount: number;
  original_currency: string;
  exchange_rate: number;
  amount_usd: number;
  status: string;
  reference: string;
  related_collection: string;
  related_id: string;
  by: string;
  notes: string;
  created: string;
}

export function TransactionDetailPage() {
  const { id } = useParams();
  const pb = getPb();
  const [txn, setTxn] = useState<Txn | null>(null);
  const [userName, setUserName] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // The URL may carry either the PocketBase record id (dashboard links)
        // or the human-facing transaction_id (sales/payments links). Try both.
        let t: Txn | null = null;
        try {
          t = await pb.collection("transactions").getOne<Txn>(id!);
        } catch {
          t = await pb.collection("transactions").getFirstListItem<Txn>(`transaction_id = '${id}'`);
        }
        setTxn(t);
        if (t.by) {
          try { const u = await pb.collection("users").getOne(t.by); setUserName(u.name); } catch { /* noop */ }
        }
        // Resolve linked records for traceability
        const links: Record<string, string> = {};
        if (t.related_id) {
          try {
            const rec = await pb.collection(t.related_collection).getOne(t.related_id);
            if (rec) {
              if (t.related_collection === "sales") links["Sale"] = rec.sale_id;
              if (t.related_collection === "payments") links["Payment"] = rec.payment_id;
              if (t.related_collection === "expenses") links["Expense"] = rec.expense_id;
              if (t.related_collection === "damage_records") links["Damage"] = rec.damage_id;
              if (t.related_collection === "payroll") links["Payroll"] = rec.payroll_id;
              if (t.related_collection === "receipts") links["Receipt"] = rec.receipt_id;
            }
          } catch { /* noop */ }
        }
        setLinks(links);
      } catch (e) {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, pb]);

  if (loading) return <CardSkeleton rows={5} />;
  if (error || !txn) return <SectionError message="Unable to load transaction." onRetry={() => window.location.reload()} />;

  const typeLabel = txn.type.replace(/_/g, " ");

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/reports" className="btn small ghost" style={{ marginRight: 8 }}><ArrowLeft size={14} style={{ verticalAlign: "-2px" }} /> Back</Link>
          <h1 style={{ display: "inline-block", margin: 0 }}><code>{txn.transaction_id}</code></h1>
        </div>
        <span className={`badge ${txn.status === "completed" ? "green" : "red"}`}>{txn.status}</span>
      </div>

      <div className="card">
        <h3>Transaction Details</h3>
        <div className="detail-grid">
          <span>Type</span><span className="capitalize">{typeLabel}</span>
          <span>Date</span><span>{new Date(txn.date || txn.created).toLocaleString()}</span>
          <span>User</span><span>{userName || "—"}</span>
          <span>Original Amount</span><span>{txn.original_amount.toLocaleString()} {txn.original_currency}</span>
          <span>Exchange Rate</span><span>{rateLabel(txn.exchange_rate)}</span>
          <span>USD Equivalent</span><span className="money-usd">{usd(txn.amount_usd)}</span>
          <span>Reference</span><span>{txn.reference || "—"}</span>
          <span>Notes</span><span>{txn.notes || "—"}</span>
        </div>
      </div>

      {Object.keys(links).length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Related Records</h3>
          <div className="detail-grid">
            {Object.entries(links).flatMap(([label, val]) => [
              <span key={`l-${label}`}>{label}</span>,
              <span key={`v-${label}`}><code>{val}</code></span>,
            ])}
          </div>
        </div>
      )}

      {Object.keys(links).length === 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <EmptyState title="No related records found for this transaction." />
        </div>
      )}
    </div>
  );
}
