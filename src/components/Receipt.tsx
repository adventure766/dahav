import { usd, ssp, rateLabel } from "../lib/currency";

export interface ReceiptData {
  company?: {
    company_name?: string;
    address?: string;
    phone?: string;
    email?: string;
    tax_id?: string;
  };
  receipt_id: string;
  sale_id?: string;
  invoice_id?: string;
  transaction_id?: string;
  date?: string;
  cashier?: string;
  customer?: string;
  items?: Array<{ product_name: string; quantity: number; unit_price?: number; line_total?: number }>;
  subtotal?: number;
  discount?: number;
  total?: number;
  payment_currency?: "USD" | "SSP";
  exchange_rate?: number;
  /** Full amount required, in payment currency. */
  amount_due?: number;
  /** Actual amount received for THIS payment, in payment currency. */
  amount_paid?: number;
  tendered?: number;
  change?: number;
  /** USD equivalent of the ACTUAL payment (never the sale total). */
  amount_usd?: number;
  payment_method?: string;
  transaction_status?: string;
  /** USD outstanding on the sale (0 when settled). */
  outstanding?: number;
  /** Cumulative USD paid on the sale across all payments. */
  total_paid?: number;
  /** Outstanding in the PAYMENT currency (exact in-currency subtraction). */
  outstanding_ccy?: number;
  /** Cumulative paid in the PAYMENT currency. */
  total_paid_ccy?: number;
}

/** Professional, printable receipt. Works with browser print + thermal (80mm). */
export function Receipt({ data }: { data: ReceiptData }) {
  const company = data.company?.company_name || "DAHAV General Trading Co. Ltd";
  const cur = data.payment_currency === "SSP" ? "SSP" : "USD";
  const fmt = (v: number) => (cur === "SSP" ? ssp(v) : usd(v));
  const total = Number(data.total ?? data.amount_usd ?? 0);
  // Outstanding/paid in the receipt's payment currency. New receipts store
  // exact in-currency values (outstanding_ccy / total_paid_ccy); older ones
  // fall back to the USD authoritative values.
  const outstanding = cur === "SSP"
    ? Number(data.outstanding_ccy ?? data.outstanding ?? 0)
    : Number(data.outstanding ?? data.outstanding_ccy ?? 0);
  const totalPaid = cur === "SSP"
    ? Number(data.total_paid_ccy ?? data.total_paid ?? data.amount_usd ?? total)
    : Number(data.total_paid ?? data.total_paid_ccy ?? data.amount_usd ?? total);
  const status = (data.transaction_status || (outstanding > 0 ? "partial" : "completed")).toUpperCase();

  return (
    <div className="receipt" id="print-receipt">
      <div className="company">{company}</div>
      {data.company?.address && <div className="center">{data.company.address}</div>}
      {data.company?.phone && <div className="center">{data.company.phone}</div>}
      {data.company?.email && <div className="center">{data.company.email}</div>}
      {data.company?.tax_id && <div className="center">Tax: {data.company.tax_id}</div>}
      <div className="divider" />

      <div className="row"><span>Receipt No</span><span>{data.receipt_id}</span></div>
      {data.transaction_id && <div className="row"><span>Transaction</span><span>{data.transaction_id}</span></div>}
      {data.sale_id && <div className="row"><span>Sale</span><span>{data.sale_id}</span></div>}
      {data.invoice_id && <div className="row"><span>Invoice</span><span>{data.invoice_id}</span></div>}
      {data.date && (
        <div className="row">
          <span>{new Date(data.date).toLocaleDateString()} {new Date(data.date).toLocaleTimeString()}</span>
          <span>{data.cashier || ""}</span>
        </div>
      )}
      {data.customer && <div className="row"><span>Customer</span><span>{data.customer}</span></div>}
      <div className="divider" />

      {(data.items || []).map((i, idx) => (
        <div key={idx} className="line-item">
          <div>{i.product_name}</div>
          <div className="row">
            <span>{i.quantity} × {usd(i.unit_price ?? 0)}</span>
            <span>{usd(i.line_total ?? (i.quantity * (i.unit_price ?? 0)))}</span>
          </div>
        </div>
      ))}
      <div className="divider" />

      <div className="row"><span>Subtotal</span><span>{usd(data.subtotal ?? 0)}</span></div>
      {Number(data.discount) > 0 && <div className="row"><span>Discount</span><span>−{usd(data.discount ?? 0)}</span></div>}
      <div className="total-row"><span>Grand Total</span><span>{usd(total)}</span></div>
      <div className="row"><span>Total Paid</span><span className={cur === "SSP" ? "money-ssp" : "money-usd"}>{fmt(totalPaid)}</span></div>
      <div className="row"><span>Outstanding</span><span className={cur === "SSP" ? "money-ssp" : "money-usd"}>{fmt(outstanding)}</span></div>
      <div className="row"><span>Status</span><span className="capitalize">{status}</span></div>
      <div className="divider" />

      <div className="row"><span>Payment Currency</span><span>{cur}</span></div>
      {data.exchange_rate && <div className="row"><span>Exchange Rate</span><span>{rateLabel(data.exchange_rate)}</span></div>}
      {data.amount_due !== undefined && (
        <div className="row">
          <span>Amount Due</span>
          <span className={cur === "SSP" ? "money-ssp" : "money-usd"}>
            {cur === "SSP" ? ssp(data.amount_due) : usd(data.amount_due)}
          </span>
        </div>
      )}
      {data.amount_paid !== undefined && (
        <div className="row">
          <span>Amount Paid</span>
          <span className={cur === "SSP" ? "money-ssp" : "money-usd"}>
            {cur === "SSP" ? ssp(data.amount_paid) : usd(data.amount_paid)}
          </span>
        </div>
      )}
      <div className="row"><span>USD Equivalent</span><span className="money-usd">{usd(data.amount_usd ?? data.total ?? 0)}</span></div>
      {data.tendered !== undefined && data.tendered > 0 && (
        <div className="row">
          <span>Tendered</span>
          <span className={cur === "SSP" ? "money-ssp" : "money-usd"}>
            {cur === "SSP" ? ssp(data.tendered) : usd(data.tendered)}
          </span>
        </div>
      )}
      {data.change !== undefined && data.change > 0 && (
        <div className="row">
          <span>Change</span>
          <span className={cur === "SSP" ? "money-ssp" : "money-usd"}>
            {cur === "SSP" ? ssp(data.change) : usd(data.change)}
          </span>
        </div>
      )}
      {data.payment_method && <div className="row"><span>Payment Method</span><span className="capitalize">{data.payment_method}</span></div>}
      <div className="divider" />
      <div className="center small">Thank you for your business!</div>
    </div>
  );
}

export function printReceipt() {
  const el = document.getElementById("print-receipt");
  if (!el) return;
  const printContent = el.outerHTML;
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) { window.print(); return; }
  w.document.write(`<html><head><title>Receipt</title><style>
    body { font-family: "Courier New", monospace; font-size: 13px; margin: 16px; color: #000; }
    .receipt { max-width: 80mm; margin: 0 auto; }
    .company { text-align: center; font-weight: 700; font-size: 15px; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #333; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; }
    .total-row { display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; }
    .line-item { margin-bottom: 6px; }
    .small { font-size: 11px; }
    .capitalize { text-transform: capitalize; }
    .money-ssp { color: #000; }
    @media print { body { margin: 0; } }
  </style></head><body>${printContent}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
