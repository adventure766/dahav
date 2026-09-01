import { useEffect, useState, useCallback } from "react";
import { Download, FileSpreadsheet, Loader2, Eye } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd, ssp, rateLabel } from "../lib/currency";
import type { SalesReportRow, ExpenseReportRow, PnlData, PaymentReportRow, InventoryReportRow, EmployeeRow } from "../lib/pdf";
import { PdfPreview, type PdfPreviewHandle } from "../components/PdfPreview";
import { ExcelPreview, type ExcelPreviewHandle } from "../components/ExcelPreview";
import { financialColumns, isSsp, filterByView, type CurrencyView } from "../lib/reportModel";

interface ReportData {
  rows?: unknown[];
  totals?: Record<string, number>;
  revenue?: number;
  cogs?: number;
  gross_profit?: number;
  operating_expenses?: number;
  other_losses?: number;
  net_profit?: number;
}

const REPORT_TYPES = [
  { key: "sales", label: "Sales Report" },
  { key: "payments", label: "Payment Report" },
  { key: "expenses", label: "Expense Report" },
  { key: "inventory", label: "Inventory Report" },
  { key: "damage", label: "Damage Report" },
  { key: "profit_loss", label: "Profit & Loss" },
  { key: "customer_debt", label: "Customer Debt Report" },
  { key: "payroll", label: "Payroll Report" },
] as const;

/** Report types that expose the All/USD/SSP currency selector. */
const CURRENCY_VIEW_TYPES = new Set(["sales", "payments", "expenses", "payroll"]);

export function ReportsPage() {
  const [type, setType] = useState<string>("sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<CurrencyView>("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [company, setCompany] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PdfPreviewHandle | null>(null);
  const [excelDoc, setExcelDoc] = useState<ExcelPreviewHandle | null>(null);

  const load = useCallback(async () => {
    const pb = getPb();
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (type === "profit_loss" && view !== "all") params.set("currency", view);
      const q = params.toString();
      const r = await fetch(`${pb.baseUrl}/api/dahav/reports/${type}${q ? "?" + q : ""}`, {
        headers: pb.authStore.token ? { Authorization: pb.authStore.token } : {},
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Report failed");
      }
      setData(await r.json());
      const s = await pb.collection("settings").getFullList<Record<string, string>>();
      if (s[0]) setCompany(s[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [type, from, to]);

  useEffect(() => { load(); }, [load]);

  const generatedAt = new Date().toLocaleString();

  const periodLabel = () => {
    if (from && to) return `${from} – ${to}`;
    if (from) return `From ${from}`;
    if (to) return `To ${to}`;
    return "All time";
  };

  const reportLabel = REPORT_TYPES.find((r) => r.key === type)?.label || "Report";

  const [pnlCurrency, setPnlCurrency] = useState<"USD" | "SSP">("USD");

  useEffect(() => {
    // P&L uses a single reporting currency; map the All view to USD.
    if (type === "profit_loss") setView(pnlCurrency);
  }, [type, pnlCurrency]);

  interface BuiltDoc { docDef: Awaited<ReturnType<typeof import("../lib/pdf")["salesPdf"]>>; title: string; filename: string; }

  const buildDoc = async (): Promise<BuiltDoc | null> => {
    if (!data) return null;
    const pdf = await import("../lib/pdf");
    const ctx = await pdf.buildContext(reportLabel.toUpperCase(), periodLabel());
    switch (type) {
      case "sales":
        return { docDef: pdf.salesPdf(ctx, data as { rows: SalesReportRow[]; totals: Record<string, number> }), title: "Sales Report", filename: `dahav-sales-report.pdf` };
      case "expenses":
        return { docDef: pdf.expensesPdf(ctx, data as { rows: ExpenseReportRow[]; totals: Record<string, number> }), title: "Expenses Report", filename: `dahav-expenses-report.pdf` };
      case "profit_loss":
        return { docDef: pdf.pnlPdf(ctx, data as PnlData), title: "Income & Profit/Loss", filename: `dahav-profit-loss.pdf` };
      case "payments":
        return { docDef: pdf.paymentsPdf(ctx, data as { rows: PaymentReportRow[]; totals: Record<string, number> }), title: "Payments Report", filename: `dahav-payments-report.pdf` };
      case "inventory":
        return { docDef: pdf.inventoryPdf(ctx, data as { rows: InventoryReportRow[]; totals: Record<string, number> }), title: "Products / Inventory", filename: `dahav-inventory-report.pdf` };
      case "payroll":
      case "customer_debt":
        return { docDef: pdf.employeesPdf(ctx, data as { rows: EmployeeRow[]; totals: Record<string, number> }), title: "Employee Report", filename: `dahav-employee-report.pdf` };
      default:
        return null;
    }
  };

  const handlePreview = async () => {
    const res = await buildDoc();
    if (res) {
      const pdf = await import("../lib/pdf");
      const blob = await pdf.generatePdf(res.docDef);
      setPdfDoc({ blob, title: res.title, filename: res.filename });
    }
  };

  const handlePrint = async () => {
    const res = await buildDoc();
    if (res) {
      const pdf = await import("../lib/pdf");
      await pdf.printPdf(res.docDef, res.title);
    }
  };

  const buildExcel = async (): Promise<ExcelPreviewHandle | null> => {
    if (!data) return null;
    const ex = await import("../lib/excel");
    const pdf = await import("../lib/pdf");
    const ctx = await pdf.buildContext(reportLabel.toUpperCase(), periodLabel());
    let wb: import("exceljs").Workbook;
    let filename: string;
    switch (type) {
      case "sales":
        wb = ex.salesExcel(ctx, data as { rows: SalesReportRow[]; totals: Record<string, number> });
        filename = "dahav-sales-report.xlsx";
        break;
      case "expenses":
        wb = ex.expensesExcel(ctx, data as { rows: ExpenseReportRow[]; totals: Record<string, number> });
        filename = "dahav-expenses-report.xlsx";
        break;
      case "profit_loss":
        wb = ex.pnlExcel(ctx, data as PnlData);
        filename = "dahav-profit-loss-report.xlsx";
        break;
      case "payments":
        wb = ex.paymentsExcel(ctx, data as { rows: PaymentReportRow[]; totals: Record<string, number> });
        filename = "dahav-payments-report.xlsx";
        break;
      case "inventory":
        wb = ex.inventoryExcel(ctx, data as { rows: InventoryReportRow[]; totals: Record<string, number> });
        filename = "dahav-inventory-report.xlsx";
        break;
      case "payroll":
      case "customer_debt":
        wb = ex.employeesExcel(ctx, data as { rows: EmployeeRow[]; totals: Record<string, number> });
        filename = "dahav-employee-report.xlsx";
        break;
      default:
        return null;
    }
    return { wb, title: reportLabel, filename };
  };

  const handleExcelPreview = async () => {
    const res = await buildExcel();
    if (res) setExcelDoc(res);
  };

  const money = (v: number, c: string) => (isSsp(c) ? ssp(v) : usd(v));

  return (
    <div>
      <div className="page-head">
        <h1>Reports</h1>
        <div className="tab-row">
          <select value={type} onChange={(e) => setType(e.target.value)} className="report-type-select">
            {REPORT_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          {CURRENCY_VIEW_TYPES.has(type) && (
            <select value={view} onChange={(e) => setView(e.target.value as CurrencyView)} aria-label="Currency" className="currency-view">
              <option value="all">All currencies</option>
              <option value="USD">USD only</option>
              <option value="SSP">SSP only</option>
            </select>
          )}
          {type === "profit_loss" && (
            <select value={pnlCurrency} onChange={(e) => setPnlCurrency(e.target.value as "USD" | "SSP")} aria-label="Reporting currency">
              <option value="USD">Reporting: USD</option>
              <option value="SSP">Reporting: SSP</option>
            </select>
          )}
          <button className="btn primary" onClick={load} disabled={busy}>{busy ? "Loading…" : "Generate"}</button>
          <button className="btn" onClick={handlePreview} disabled={busy || !data}><Eye size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />Preview PDF</button>
          <button className="btn" onClick={handleExcelPreview} disabled={busy || !data}><FileSpreadsheet size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />Preview Excel</button>
          <button className="btn no-print" onClick={handlePrint} disabled={busy || !data}><Download size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />Print</button>
          {busy && <Loader2 size={16} className="busy-pulse" style={{ alignSelf: "center" }} />}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="card report">
        <div className="report-header">
          <h2 className="report-company">{company.company_name || "DAHAV"}</h2>
          <h3>{reportLabel}</h3>
          <p className="muted small">
            {from && to ? `Period: ${from} → ${to}` : from ? `From: ${from}` : to ? `To: ${to}` : "All time"}
            {" "}· Generated: {generatedAt}
            {view !== "all" && <> · Currency: {view}</>}
          </p>
        </div>
        <ReportBody type={type} data={data} view={view} money={money} />
      </div>

      {pdfDoc && <PdfPreview doc={pdfDoc} onClose={() => setPdfDoc(null)} />}
      {excelDoc && <ExcelPreview doc={excelDoc} onClose={() => setExcelDoc(null)} />}
    </div>
  );
}

function ReportBody({ type, data, view, money }: { type: string; data: ReportData | null; view: CurrencyView; money: (v: number, c: string) => string }) {
  if (!data) return <div className="empty">Loading report…</div>;
  if (type === "profit_loss") return <ProfitLossReport data={data} />;
  let rows = (data.rows || []) as Record<string, unknown>[];
  const totals = (data.totals || {}) as Record<string, number>;
  if (view === "USD" || view === "SSP") {
    rows = filterByView(rows as unknown as Parameters<typeof filterByView>[0], view) as unknown as Record<string, unknown>[];
  }
  const cols = columnsFor(type, view);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key}>{renderCell(c, r, view, money)}</td>)}</tr>)}
          {rows.length === 0 && <tr><td colSpan={cols.length} className="empty">No records in this range</td></tr>}
        </tbody>
      </table>
      <div className="report-totals">
        {Object.entries(totals).map(([k, v]) => (
          <div className="totals-row" key={k}>
            <span>{prettyKey(k)}</span>
            <span>{formatTotal(k, v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfitLossReport({ data }: { data: ReportData }) {
  const reportingCurrency = (data as { reporting_currency?: string }).reporting_currency || "USD";
  const rate = (data as { reporting_rate?: number }).reporting_rate;
  const money = (v: number) => (isSsp(reportingCurrency) ? ssp(v) : usd(v));
  return (
    <div className="pnl">
      <div className="totals-row"><span>Revenue (sales)</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>{money(data.revenue ?? 0)}</span></div>
      <div className="totals-row"><span>Cost of Goods Sold</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>−{money(data.cogs ?? 0)}</span></div>
      <div className="totals-row grand"><span>Gross Profit</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>{money(data.gross_profit ?? 0)}</span></div>
      <div className="totals-row"><span>Operating Expenses</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>−{money(data.operating_expenses ?? 0)}</span></div>
      <div className="totals-row"><span>Other Losses (damage)</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>−{money(data.other_losses ?? 0)}</span></div>
      <div className="totals-row grand"><span>Net Profit</span><span className={isSsp(reportingCurrency) ? "money-ssp" : "money-usd"}>{money(data.net_profit ?? 0)}</span></div>
      <p className="muted small">
        Reporting currency: {reportingCurrency}. All values converted using recorded historical rates.
        {rate ? ` (1 USD = ${rate.toLocaleString("en-US")} SSP)` : ""}
      </p>
    </div>
  );
}

function columnsFor(type: string, view: CurrencyView): Array<{ key: string; label: string; right?: boolean; currencyKey?: string }> {
  switch (type) {
    case "sales":
    case "payments":
    case "expenses":
    case "payroll":
      return financialColumns(view);
    case "inventory":
      return [
        { key: "name", label: "Product" }, { key: "sku", label: "SKU" }, { key: "stock", label: "Stock" },
        { key: "unit_cost", label: "Unit Cost", right: true, currencyKey: "currency" }, { key: "inventory_value", label: "Value", right: true, currencyKey: "currency" },
        { key: "currency", label: "Currency" },
      ];
    case "damage":
      return [
        { key: "date", label: "Date" }, { key: "damage_id", label: "Damage ID" }, { key: "transaction_id", label: "Transaction" },
        { key: "quantity", label: "Qty" }, { key: "unit_cost", label: "Unit Cost", right: true, currencyKey: "currency" },
        { key: "total_cost", label: "Total Loss", right: true, currencyKey: "currency" }, { key: "currency", label: "Currency" }, { key: "reason", label: "Reason" },
      ];
    case "customer_debt":
      return [
        { key: "name", label: "Customer" }, { key: "phone", label: "Phone" },
        { key: "total_purchases", label: "Purchases" }, { key: "total_paid", label: "Paid" },
        { key: "outstanding", label: "Outstanding" }, { key: "credit", label: "Credit" },
      ];
    default:
      return [];
  }
}

function renderCell(col: { key: string; label: string; right?: boolean; currencyKey?: string }, row: Record<string, unknown>, _view: CurrencyView, money: (v: number, c: string) => string): React.ReactNode {
  const v = row[col.key];
  if (v === undefined || v === null || v === "") return "—";
  if (col.key === "date") return <span className="muted">{new Date(String(v)).toLocaleDateString()}</span>;
  const isMoney = "currencyKey" in col && col.currencyKey || ["total", "subtotal", "amount_paid", "amount_outstanding", "amount_usd", "amount_ssp", "total_cost", "unit_cost", "inventory_value", "net_salary", "total_purchases", "total_paid", "outstanding", "credit"].includes(col.key);
  if (isMoney) {
    const cur = (row.currency as string) || "USD";
    return <span className={isSsp(cur) ? "money-ssp" : "money-usd"}>{money(Number(v), cur)}</span>;
  }
  if (col.key === "amount") {
    // Original amount is always shown in its own currency.
    const cur = (row.currency as string) || "USD";
    return <span className={isSsp(cur) ? "money-ssp" : "money-usd"}>{money(Number(v), cur)}</span>;
  }
  if (col.key === "exchange_rate") return <span className="muted">{rateLabel(Number(v))}</span>;
  if (col.key === "payment_currency") {
    const pays = (row.payments as Array<{ amount: number; currency: string; exchange_rate: number; amount_usd: number }> | undefined) || [];
    if (pays.length === 0) return <span className="muted">—</span>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {pays.map((p, i) => {
          const c = (p.currency || "USD").toUpperCase();
          return (
            <span key={i} className="muted small" style={{ whiteSpace: "nowrap" }}>
              <span className={`badge ${isSsp(c) ? "ssp" : "usd"}`}>{c}</span>{" "}
              {c === "SSP" ? ssp(p.amount) : usd(p.amount)} @ {rateLabel(p.exchange_rate)} (={usd(p.amount_usd)})
            </span>
          );
        })}
      </div>
    );
  }
  if (col.key === "currency") return <span className={`badge ${isSsp(String(v)) ? "ssp" : "usd"}`}>{String(v)}</span>;
  if (col.key === "status") {
    const map: Record<string, string> = { completed: "green", paid: "green", partial: "yellow", credit: "yellow", void: "red" };
    return <span className={`badge ${map[String(v)] || "gray"}`}>{String(v)}</span>;
  }
  return String(v);
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTotal(k: string, v: number): string {
  if (k.includes("ssp")) return ssp(v);
  if (k.includes("usd") || k.includes("value") || k.includes("sales") || k.includes("paid") || k.includes("cost") || k.includes("outstanding") || k.includes("credit") || k.includes("profit") || k.includes("loss")) {
    return usd(v);
  }
  return v.toLocaleString();
}
