import { useEffect, useState, useCallback } from "react";
import { Printer, Trash2, Download } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd, ssp, rateLabel } from "../lib/currency";
import { Receipt, type ReceiptData } from "../components/Receipt";

interface Payment {
  id: string;
  payment_id: string;
  transaction: string;
  sale: string;
  customer: string;
  received_by: string;
  amount: number;
  currency: "USD" | "SSP";
  exchange_rate: number;
  amount_usd: number;
  payment_method: string;
  tendered: number;
  change: number;
  status: string;
  created: string;
}

interface ReceiptRecord {
  id: string;
  receipt_id: string;
  transaction: string;
  payment: string;
  sale: string;
  data: ReceiptData;
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReceiptRecord | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const pb = getPb();
    const [p, c, r] = await Promise.all([
      pb.collection("payments").getFullList<Payment>({ sort: "-created" }),
      pb.collection("customers").getFullList<{ id: string; name: string }>(),
      pb.collection("receipts").getFullList<ReceiptRecord>({ sort: "-created" }),
    ]);
    setPayments(p);
    setCustomers(Object.fromEntries(c.map((x) => [x.id, x.name])));
    setReceipts(r);
  }, []);

  useEffect(() => { load().catch((e) => setError("Failed to load payments: " + e.message)); }, [load]);

  const findReceipt = (query: string) => {
    const q = query.trim().toUpperCase();
    if (!q) return;
    const rec = receipts.find((r) =>
      r.receipt_id.toUpperCase() === q ||
      (r.data.transaction_id || "").toUpperCase() === q ||
      (r.data.sale_id || "").toUpperCase() === q,
    ) || payments.find((p) => p.payment_id.toUpperCase() === q) && receipts.find((r) => r.payment === payments.find((p) => p.payment_id.toUpperCase() === q)?.id);
    if (rec) {
      setSelected(rec);
    } else {
      setError(`No receipt found for "${query}". Try a receipt, transaction, sale, or payment ID.`);
    }
  };

  const showReceiptForPayment = async (p: Payment) => {
    const rec = receipts.find((r) => r.payment === p.id);
    if (rec) { setSelected(rec); return; }
    // Fallback: build from payment record
    const saleRec = p.sale ? await getPb().collection("sales").getOne(p.sale).catch(() => null) : null;
    const saleTotal = saleRec?.total ?? p.amount_usd;
    // Full amount required in the payment currency (not the amount paid).
    const fullDue = p.currency === "SSP"
      ? Math.round(saleTotal * (p.exchange_rate || 8000) * 100) / 100
      : saleTotal;
    // Payment-currency outstanding = due - this payment (exact in-currency).
    const outstandingCcy = Math.max(0, Math.round((fullDue - p.amount) * 100) / 100);
    setSelected({
      id: "tmp",
      receipt_id: p.payment_id,
      transaction: p.transaction,
      payment: p.id,
      sale: p.sale,
      data: {
        receipt_id: p.payment_id,
        transaction_id: p.transaction,
        sale_id: saleRec?.sale_id,
        date: p.created,
        payment_currency: p.currency,
        exchange_rate: p.exchange_rate,
        amount_due: fullDue,
        amount_paid: p.amount,
        tendered: p.tendered,
        change: p.change,
        amount_usd: p.amount_usd,
        payment_method: p.payment_method,
        total: saleTotal,
        total_paid: saleRec?.amount_paid ?? p.amount_usd,
        total_paid_ccy: p.amount,
        outstanding: saleRec?.amount_outstanding ?? 0,
        outstanding_ccy: outstandingCcy,
        transaction_status: saleRec?.status || "completed",
        subtotal: saleTotal,
        customer: p.customer ? customers[p.customer] : "",
      },
    });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Payments</h1>
        <div className="receipt-search">
          <input
            placeholder="Receipt / Txn / Sale / Payment ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findReceipt(search)}
          />
          <button className="btn" onClick={() => findReceipt(search)}>Find</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="grid auto-fit" style={{ gap: 16 }}>
        <div className="card table-wrap">
          <table className="payments-table">
            <thead>
              <tr><th>Payment ID</th><th>Customer</th><th>Amount</th><th>Currency</th><th>USD</th><th>Rate</th><th>Method</th><th>Status</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.payment_id}</td>
                  <td>{p.customer ? customers[p.customer] || "—" : "Walk-in"}</td>
                  <td className={p.currency === "SSP" ? "money-ssp" : "money-usd"}>{p.currency === "SSP" ? ssp(p.amount) : usd(p.amount)}</td>
                  <td>{p.currency}</td>
                  <td className="money-usd">{usd(p.amount_usd)}</td>
                  <td className="muted">{rateLabel(p.exchange_rate)}</td>
                  <td className="capitalize">{p.payment_method}</td>
                  <td><span className={`badge ${p.status === "paid" ? "green" : "yellow"}`}>{p.status}</span></td>
                  <td className="muted">{new Date(p.created).toLocaleDateString()}</td>
                  <td>
                    <button className="btn small" onClick={() => showReceiptForPayment(p)}>Receipt</button>{" "}
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        if (!window.confirm(`Delete payment ${p.payment_id} (${usd(p.amount_usd)})? Its receipt and ledger transaction will also be deleted. The sale stays.`)) return;
                        const r = await api(`/api/dahav/records/payments/${p.id}`, { method: "DELETE" });
                        if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); return; }
                        setSelected(null);
                        await load();
                      }}
                      aria-label={`Delete ${p.payment_id}`}
                    >
                      <Trash2 size={14} style={{ verticalAlign: "-2px" }} />
                    </button>
                  </td>
                </tr>
              ))}
              {payments.length === 0 && <tr><td colSpan={10} className="empty">No payments yet</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          {selected ? (
            <>
              <div className="page-head">
                <h2 style={{ fontSize: 18 }}>{selected.receipt_id}</h2>
                <button
                  className="btn primary small no-print"
                  onClick={async () => {
                    const pdf = await import("../lib/pdf");
                    const doc = pdf.receiptPdf(selected.data as import("../lib/pdf").ReceiptPdfData);
                    pdf.printPdf(doc, "Receipt");
                  }}
                ><Printer size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />Print PDF</button>
                <button
                  className="btn small no-print"
                  onClick={async () => {
                    const pdf = await import("../lib/pdf");
                    const doc = pdf.receiptPdf(selected.data as import("../lib/pdf").ReceiptPdfData);
                    pdf.downloadPdf(doc, `${selected.receipt_id}.pdf`);
                  }}
                ><Download size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />Download</button>
              </div>
              <Receipt data={selected.data} />
            </>
          ) : (
            <div className="empty">Select a payment to view its receipt. Receipts are printable and reprintable any time.</div>
          )}
        </div>
      </div>
    </div>
  );
}
