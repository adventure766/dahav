/**
 * DAHAV PDF generator.
 *
 * Generates actual PDF documents (pdfmake) from the SAME authoritative
 * report endpoints the web UI consumes. No financial calculation happens
 * here — totals, transaction IDs, currencies and dates all come from the
 * report data, so PDF == web report == database.
 *
 * Design language (from the redesigned templates):
 *  - minimalist, document-oriented
 *  - horizontal rules, no vertical table borders
 *  - generous whitespace, clean typography
 *  - summary metric bar under the title
 *  - currency is contextual: SSP only appears where the data has SSP
 */
import * as pdfmake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import type { TDocumentDefinitions, TCreatedPdf } from "pdfmake/interfaces";
import { getPb } from "./pb";
import { usd, ssp, rateLabel } from "./currency";

/** Permissive content item for building documents; validated by pdfmake at runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentItem = Record<string, any>;

// Register Roboto fonts via pdfmake's proper API (namespace is frozen)
const fontVfs = pdfFonts as unknown as Record<string, string>;
if (typeof pdfmake.addVirtualFileSystem === "function") {
  pdfmake.addVirtualFileSystem(fontVfs);
  pdfmake.setFonts({
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  });
} else {
  // Fallback for older builds
  (pdfmake as unknown as { virtualfs: Record<string, string> }).virtualfs = fontVfs;
}
if (typeof window !== "undefined") (window as unknown as { pdfMake: typeof pdfmake }).pdfMake = pdfmake;

export interface CompanyInfo {
  company_name: string;
  address: string;
  phone: string;
  email: string;
  tax_id: string;
}

export interface DocContext {
  company: CompanyInfo;
  reportTitle: string;
  periodLabel: string;
  generatedAt: string;
  currency: string;
  orientation?: "portrait" | "landscape";
}

/** Format a number in its own currency (contextual). */
function money(amount: number, currency: string): string {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "SSP") return ssp(amount);
  return usd(amount);
}

/** Doc definition with a permissive content array for building. */
export type DocDef = Omit<TDocumentDefinitions, "content"> & { content: ContentItem[] };

export function baseDoc(ctx: DocContext): DocDef {
  const geo = ctx.orientation === "landscape" ? PAGE.landscape : PAGE.portrait;
  return {
    pageSize: "A4",
    pageOrientation: ctx.orientation || "portrait",
    pageMargins: geo.margins,
    footer: (currentPage: number, pageCount: number) => ({
      margin: [geo.margins[0], 0, geo.margins[0], 8],
      columns: [
        { text: "DAHAV Business Management System", fontSize: 7, color: "#9aa3ad", alignment: "left" },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: "#9aa3ad", alignment: "right" },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 8.5, color: "#1f2430" },
    content: [] as ContentItem[],
    styles: {
      companyName: { fontSize: 13, bold: true, color: "#111827" },
      reportTitle: { fontSize: 10.5, bold: true, color: "#374151", margin: [0, 1, 0, 0] },
      metaRow: { fontSize: 7.5, color: "#6b7280", margin: [0, 2, 0, 0] },
      metricBar: { margin: [0, 6, 0, 0] },
      metricText: { fontSize: 8, color: "#374151" },
      metricValue: { fontSize: 8, bold: true, color: "#111827" },
      tableHeader: { fontSize: 7.5, bold: true, color: "#4b5563", margin: [0, 0, 0, 1] },
      tableCell: { fontSize: 8, color: "#1f2430", margin: [0, 1, 0, 1] },
      totalsLabel: { fontSize: 8.5, bold: true, color: "#111827", alignment: "right" },
      totalsValue: { fontSize: 8.5, bold: true, color: "#111827", alignment: "right" },
      footerNote: { fontSize: 7, color: "#9aa3ad", margin: [0, 6, 0, 0] },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Page geometry — A4 landscape, 15mm side margins, compact top/bottom
 * ------------------------------------------------------------------ */

export const PAGE = {
  portrait: { width: 595.28, height: 841.89, margins: [40, 26, 40, 36] as [number, number, number, number], contentW: 515.28 },
  landscape: { width: 841.89, height: 595.28, margins: [42, 22, 42, 30] as [number, number, number, number], contentW: 757.89 },
} as const;

/** Thin horizontal rule. */
function hr(w = 515): ContentItem {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: w, y2: 0, lineWidth: 0.6, lineColor: "#d1d5db" }], margin: [0, 3, 0, 4] };
}

/** Double rule for major section breaks. */
function hrDouble(w = 515): ContentItem {
  return {
    canvas: [
      { type: "line", x1: 0, y1: 0, x2: w, y2: 0, lineWidth: 0.9, lineColor: "#374151" },
      { type: "line", x1: 0, y1: 2.5, x2: w, y2: 2.5, lineWidth: 0.4, lineColor: "#9aa3ad" },
    ],
    margin: [0, 5, 0, 6],
  };
}

/** Header block: company + title + period/generated meta + top rule. */
export function headerBlock(ctx: DocContext): ContentItem[] {
  const w = ctx.orientation === "landscape" ? PAGE.landscape.contentW : PAGE.portrait.contentW;
  return [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: w, y2: 0, lineWidth: 0.9, lineColor: "#111827" }], margin: [0, 0, 0, 6] },
    { text: ctx.company.company_name || "DAHAV General Trading Co. Ltd", style: "companyName" },
    { text: ctx.reportTitle.toUpperCase(), style: "reportTitle" },
    {
      text: [
        { text: `Reporting period:  `, color: "#6b7280" },
        { text: ctx.periodLabel, color: "#111827" },
        { text: `   |   Generated:  `, color: "#6b7280" },
        { text: ctx.generatedAt, color: "#111827" },
      ],
      style: "metaRow",
    },
    hrDouble(w),
  ];
}

/** Summary metric bar: "Label value | Label value ..." under a thin rule. */
export function metricBar(metrics: Array<{ label: string; value: string }>): ContentItem[] {
  const items: ContentItem[] = [];
  metrics.forEach((m, i) => {
    items.push(
      { text: `${m.label}  `, style: "metricText" },
      { text: m.value, style: "metricValue" },
      ...(i < metrics.length - 1 ? [{ text: "   |   ", style: "metricText" }] : []),
    );
  });
  return [
    { text: items, style: "metricBar" },
    hr(),
  ];
}

export interface TableSpec {
  headers: string[];
  rows: Array<Array<string | number>>;
  /** Numeric column indexes to right-align */
  alignRight?: number[];
  /** Column width weights. Values are relative; they are normalized to the content width. */
  weights?: number[];
  /** Columns whose text may wrap (long IDs, names). Default: none (no wrap). */
  wrap?: number[];
  /** Cell font size (default 8.5). */
  fontSize?: number;
  /** Header font size (default 8). */
  headerFontSize?: number;
  /** Cell vertical padding (default 3). */
  padding?: number;
  /** Total content width available (default portrait 515). */
  contentWidth?: number;
  /** Keep rows intact across pages (default true). */
  keepRows?: boolean;
}

/**
 * Build a rule-only table that ALWAYS fits the printable width.
 * Column widths are computed from weights, normalized to the content width,
 * and long cells wrap so nothing is ever clipped.
 */
export function ruleTable(spec: TableSpec): ContentItem {
  const { headers, rows, alignRight = [], weights = [], wrap = [], contentWidth = PAGE.portrait.contentW, fontSize = 8, headerFontSize = 7.5, padding = 2, keepRows = true } = spec;
  const n = headers.length;
  const w = weights.length === n ? weights : Array.from({ length: n }, () => 1);
  const totalWeight = w.reduce((s, x) => s + x, 0);
  // pdfmake absorbs horizontal cell padding inside each column's declared
  // width. Still, reserve breathing room so the last column never touches
  // the right margin (long values like COMPLETED must never clip).
  const padTotal = padding * 2 * n;
  const safety = Math.min(14, contentWidth * 0.015);
  const usable = Math.max(contentWidth - padTotal - safety, 40);
  const widths = w.map((x) => Math.round((x / totalWeight) * usable * 100) / 100);
  // Ensure the sum equals usable exactly (last column absorbs rounding)
  const sum = widths.reduce((s, x) => s + x, 0);
  widths[n - 1] = Math.round((widths[n - 1] + (usable - sum)) * 100) / 100;

  const cell = (v: string | number, i: number, style: string): ContentItem => ({
    text: String(v ?? ""),
    style,
    fontSize,
    alignment: alignRight.includes(i) ? "right" : "left",
    ...(wrap.includes(i) ? { noWrap: false } : { noWrap: true }),
  });

  const body: Array<Array<ContentItem>> = [
    headers.map((h, i) => ({ text: h.toUpperCase(), style: "tableHeader", fontSize: headerFontSize, alignment: alignRight.includes(i) ? "right" : "left", noWrap: true })),
    ...rows.map((r) => r.map((c, i) => cell(c, i, "tableCell"))),
  ];

  return {
    table: {
      widths,
      headerRows: 1,
      dontBreakRows: keepRows,
      body,
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0 : i === 1 ? 0.8 : 0.3),
      hLineColor: () => "#d1d5db",
      vLineWidth: () => 0,
      paddingLeft: () => padding,
      paddingRight: () => padding,
      paddingTop: () => Math.max(1, Math.floor(padding / 2)),
      paddingBottom: () => Math.max(1, Math.floor(padding / 2)),
    },
  };
}

/** Totals block: right-aligned label/value pairs under a rule. */
export function totalsBlock(rows: Array<{ label: string; value: string; strong?: boolean }>): ContentItem[] {
  return [
    hr(),
    ...rows.map((r) => ({
      columns: [
        { text: r.label, style: r.strong ? "totalsLabel" : { ...baseStyles.totalsLabel, fontSize: 8, bold: false, color: "#374151" } },
        { text: r.value, style: r.strong ? "totalsValue" : { ...baseStyles.totalsValue, fontSize: 8, bold: false, color: "#374151" } },
      ],
      columnGap: 8,
      margin: [0, 0.5, 0, 0.5],
    })),
  ];
}

// Helper for inline styles without full doc context
const baseStyles = {
  totalsLabel: { fontSize: 8.5, bold: true, color: "#111827", alignment: "right" as const },
  totalsValue: { fontSize: 8.5, bold: true, color: "#111827", alignment: "right" as const },
};

/* ------------------------------------------------------------------ *
 * Approval / signature / stamp area (PDF reports + receipts)
 * ------------------------------------------------------------------ */

/**
 * Compact approval block for printed reports. Uses simple signature lines
 * and a bordered stamp box — no fake signatures or decorative graphics.
 * Fits within a single page's remaining space.
 */
export function approvalBlock(opts?: { stampBox?: boolean }): ContentItem[] {
  const { stampBox = true } = opts || {};
  const line = (label: string, width: number) => ({
    columns: [
      { text: label, fontSize: 8, bold: true, color: "#374151", width: 90 },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.5, lineColor: "#9aa3ad" }], width, margin: [0, 4, 0, 0] },
    ],
    margin: [0, 0, 0, 8],
  });
  const dateLine = (label: string, width: number) => ({
    columns: [
      { text: label, fontSize: 8, bold: true, color: "#374151", width: 90 },
      { text: "", fontSize: 8, width },
      { text: "Date: ______________________", fontSize: 8, color: "#6b7280", alignment: "left", width },
    ],
    margin: [0, 0, 0, 8],
  });
  const stamp = {
    table: {
      widths: [160],
      body: [[{ text: "", margin: [0, 26, 0, 26] }]],
    },
    layout: { hLineWidth: () => 0.8, hLineColor: () => "#9aa3ad", vLineWidth: () => 0.8, vLineColor: () => "#9aa3ad", paddingTop: () => 0, paddingBottom: () => 0, paddingLeft: () => 0, paddingRight: () => 0 },
    margin: [0, 4, 0, 0],
  };
  return [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: "#d1d5db" }], margin: [0, 10, 0, 8] },
    { text: "APPROVAL", fontSize: 8.5, bold: true, color: "#111827", margin: [0, 0, 0, 8] },
    line("Prepared By:", 140),
    line("Signature:", 140),
    line("Approved By:", 140),
    line("Signature:", 140),
    dateLine("Date:", 140),
    ...(stampBox ? [stamp] : []),
  ];
}

/** Smaller approval block for receipts (fits the 80mm width). */
export function receiptApprovalBlock(): ContentItem[] {
  const line = (label: string, width: number) => ({
    columns: [
      { text: label, fontSize: 8, bold: true, color: "#374151", width: 70 },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.5, lineColor: "#9aa3ad" }], width, margin: [0, 4, 0, 0] },
    ],
    margin: [0, 0, 0, 6],
  });
  const stamp = {
    table: {
      widths: [90],
      body: [[{ text: "", margin: [0, 14, 0, 14] }]],
    },
    layout: { hLineWidth: () => 0.6, hLineColor: () => "#9aa3ad", vLineWidth: () => 0.6, vLineColor: () => "#9aa3ad", paddingTop: () => 0, paddingBottom: () => 0, paddingLeft: () => 0, paddingRight: () => 0 },
    margin: [0, 2, 0, 0],
  };
  return [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#d1d5db" }], margin: [0, 8, 0, 6] },
    line("Authorized By:", 120),
    line("Signature:", 120),
    { columns: [{ text: "Date: ________________", fontSize: 8, color: "#6b7280", width: 150 }], margin: [0, 0, 0, 6] },
    stamp,
  ];
}

/* ------------------------------------------------------------------ *
 * Report builders — each consumes the same endpoint data as the web UI
 * ------------------------------------------------------------------ */

export interface SalesReportRow {
  date: string; sale_id: string; transaction_id: string; customer: string; cashier: string;
  subtotal: number; discount: number; total: number; amount_paid: number; amount_outstanding: number; status: string;
}

export function salesPdf(ctx: DocContext, data: { rows: SalesReportRow[]; totals: Record<string, number> }): DocDef {
  const doc = baseDoc({ ...ctx, orientation: "landscape" });
  const rows = (data.rows || []).map((r) => ({
    ...r,
    currency: (r as unknown as { original_currency?: string }).original_currency || "USD",
    exchange_rate: (r as unknown as { exchange_rate?: number }).exchange_rate || 0,
  }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  doc.content = [
    ...headerBlock({ ...ctx, orientation: "landscape" }),
    ...metricBar([
      { label: "Sales", value: money((data?.totals?.total_sales) ?? 0, "USD") },
      { label: "Paid", value: money((data?.totals?.total_paid) ?? 0, "USD") },
      { label: "Outstanding", value: money((data?.totals?.total_outstanding) ?? 0, "USD") },
      { label: "Units", value: String((data?.totals?.total_quantity) ?? 0) },
      { label: "Transactions", value: String((data?.totals?.count) ?? 0) },
    ]),
    ruleTable({
      headers: useAll
        ? ["Date", "Transaction ID", "Customer", "Cashier", "Original Amount", "Currency", "Rate", "Reporting", "Status"]
        : ["Date", "Transaction ID", "Customer", "Cashier", "Total", "Paid", "Outstanding", "Status"],
      rows: rows.map((r) => useAll
        ? [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.customer || "Walk-in",
            r.cashier || "—",
            money(r.total, r.currency),
            r.currency,
            r.exchange_rate ? String(r.exchange_rate) : "—",
            usd(r.total),
            r.status.toUpperCase(),
          ]
        : [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.customer || "Walk-in",
            r.cashier || "—",
            money(r.total, r.currency),
            money(r.amount_paid, r.currency),
            money(r.amount_outstanding, r.currency),
            r.status.toUpperCase(),
          ]),
      alignRight: useAll ? [4, 6, 7] : [4, 5, 6],
      weights: useAll ? [8, 15, 12, 10, 12, 8, 8, 11, 10] : [8, 18, 14, 11, 10, 10, 11, 11],
      wrap: [1, 2, 3],
      contentWidth: PAGE.landscape.contentW,
      fontSize: 8,
      headerFontSize: 7.5,
      padding: 2,
      keepRows: true,
    }),
    totalsBlock([
      { label: "Total Sales", value: money((data?.totals?.total_sales) ?? 0, "USD"), strong: true },
      { label: "Total Paid", value: money((data?.totals?.total_paid) ?? 0, "USD") },
      { label: "Outstanding", value: money((data?.totals?.total_outstanding) ?? 0, "USD") },
      { label: "Sales Count", value: String((data?.totals?.count) ?? 0) },
    ]),
    ...approvalBlock(),
    { text: "DAHAV Business Management System • Generated from authoritative persisted business data.", style: "footerNote" },
  ];
  return doc;
}

export interface ExpenseReportRow {
  date: string; expense_id: string; transaction_id: string; category: string; description: string;
  payment_method: string; amount: number; currency: string; amount_usd: number; status: string;
  exchange_rate?: number;
}

export function expensesPdf(ctx: DocContext, data: { rows: ExpenseReportRow[]; totals: Record<string, number> }): DocDef {
  const doc = baseDoc({ ...ctx, orientation: "landscape" });
  const rows = (data.rows || []).map((r) => ({ ...r, currency: r.currency || "USD" }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  const metrics: Array<{ label: string; value: string }> = [
    { label: "Expenses", value: money((data?.totals?.total_usd) ?? 0, "USD") },
    { label: "Expense Count", value: String((data?.totals?.count) ?? 0) },
  ];
  if (sspTotal > 0) metrics.push({ label: "SSP Total", value: ssp(sspTotal) });
  doc.content = [
    ...headerBlock({ ...ctx, orientation: "landscape" }),
    ...metricBar(metrics),
    ruleTable({
      headers: useAll
        ? ["Date", "Transaction ID", "Category", "Description", "Method", "Original Amount", "Currency", "Rate", "Reporting", "Status"]
        : ["Date", "Transaction ID", "Category", "Description", "Method", "Amount", "USD", "Status"],
      rows: rows.map((r) => useAll
        ? [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.category || "—",
            r.description || "—",
            (r.payment_method || "—").toUpperCase(),
            money(r.amount, r.currency),
            r.currency,
            r.exchange_rate ? String(r.exchange_rate) : "—",
            usd(r.amount_usd),
            (r.status || "COMPLETED").toUpperCase(),
          ]
        : [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.category || "—",
            r.description || "—",
            (r.payment_method || "—").toUpperCase(),
            money(r.amount, r.currency),
            usd(r.amount_usd),
            (r.status || "COMPLETED").toUpperCase(),
          ]),
      alignRight: useAll ? [5, 7, 8] : [5, 6],
      weights: useAll ? [8, 13, 11, 17, 9, 11, 8, 7, 11, 9] : [8, 17, 13, 20, 10, 12, 12, 10],
      wrap: [1, 2, 3],
      contentWidth: PAGE.landscape.contentW,
      fontSize: 8,
      headerFontSize: 7.5,
      padding: 2,
      keepRows: true,
    }),
    totalsBlock([
      { label: "Total Expenses", value: money((data?.totals?.total_usd) ?? 0, "USD"), strong: true },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
      { label: "Expense Count", value: String((data?.totals?.count) ?? 0) },
    ]),
    ...approvalBlock(),
    { text: "DAHAV Business Management System • Generated from authoritative persisted business data.", style: "footerNote" },
  ];
  return doc;
}

export interface PnlData {
  revenue: number; cogs: number; gross_profit: number; operating_expenses: number;
  other_income: number; other_losses: number; net_profit: number;
  rows?: Array<{ label: string; revenue: number; cogs: number; gross_profit: number; operating_expenses: number; other_income: number; other_losses: number; net_profit: number }>;
  sales_count?: number; expenses_count?: number;
}

export function pnlPdf(ctx: DocContext, data: PnlData): DocDef {
  const doc = baseDoc(ctx);
  const rc = (data as unknown as { reporting_currency?: string }).reporting_currency || "USD";
  const m = (v: number) => money(v, rc);
  doc.content = [
    ...headerBlock(ctx),
    ...metricBar([
      { label: "Revenue", value: m(data.revenue) },
      { label: "COGS", value: m(data.cogs) },
      { label: "Gross Profit", value: m(data.gross_profit) },
      { label: "Expenses", value: m(data.operating_expenses) },
      { label: "Net Profit", value: m(data.net_profit) },
    ]),
  ];
  if (data.rows && data.rows.length) {
    doc.content.push(
      ruleTable({
        headers: ["Period", "Revenue", "COGS", "Gross Profit", "Operating Expenses", "Other Income", "Other Loss", "Net Profit"],
        rows: data.rows.map((r) => [
          r.label, m(r.revenue), m(r.cogs), m(r.gross_profit), m(r.operating_expenses),
          m(r.other_income), m(r.other_losses), m(r.net_profit),
        ]),
        alignRight: [1, 2, 3, 4, 5, 6, 7],
        weights: [16, 12, 12, 13, 15, 11, 11, 13],
        wrap: [0],
        keepRows: true,
      }),
    );
  }
  doc.content.push(
    totalsBlock([
      { label: "Revenue", value: m(data.revenue) },
      { label: "COGS", value: m(data.cogs) },
      { label: "Gross Profit", value: m(data.gross_profit), strong: true },
      { label: "Operating Expenses", value: m(data.operating_expenses) },
      ...(data.other_income ? [{ label: "Other Income", value: m(data.other_income) }] : []),
      ...(data.other_losses ? [{ label: "Other Loss", value: m(data.other_losses) }] : []),
      { label: "Net Profit", value: m(data.net_profit), strong: true },
    ]),
    ...approvalBlock(),
    { text: `DAHAV Business Management System • Reporting currency: ${rc}. Original transaction currencies are converted using their recorded historical rates.`, style: "footerNote" },
  );
  return doc;
}

export interface PaymentReportRow {
  date: string; payment_id: string; transaction_id: string; customer: string; received_by: string;
  amount: number; currency: string; exchange_rate: number; amount_usd: number; payment_method: string; status: string;
}

export function paymentsPdf(ctx: DocContext, data: { rows: PaymentReportRow[]; totals: Record<string, number> }): DocDef {
  const doc = baseDoc({ ...ctx, orientation: "landscape" });
  const rows = (data.rows || []).map((r) => ({ ...r, currency: r.currency || "USD" }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  const metrics: Array<{ label: string; value: string }> = [
    { label: "Total Payments", value: money((data?.totals?.total_usd) ?? 0, "USD") },
    { label: "USD Payments", value: money((data?.totals?.total_usd) ?? 0, "USD") },
  ];
  if (sspTotal > 0) metrics.push({ label: "SSP Payments", value: ssp(sspTotal) });
  metrics.push({ label: "Payment Count", value: String((data?.totals?.count) ?? 0) });
  doc.content = [
    ...headerBlock({ ...ctx, orientation: "landscape" }),
    ...metricBar(metrics),
    // Payments report keeps the ORIGINAL currency — it is meaningful here.
    ruleTable({
      headers: useAll
        ? ["Date", "Transaction ID", "Customer", "Method", "Original Amount", "Currency", "Rate", "USD Equivalent", "Status"]
        : ["Date", "Transaction ID", "Customer", "Method", "Amount", "USD Equivalent", "Status"],
      rows: rows.map((r) => useAll
        ? [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.customer || "Walk-in",
            (r.payment_method || "—").toUpperCase(),
            money(r.amount, r.currency),
            r.currency,
            r.exchange_rate ? String(r.exchange_rate) : "—",
            usd(r.amount_usd),
            (r.status || "COMPLETED").toUpperCase(),
          ]
        : [
            new Date(r.date).toLocaleDateString("en-GB"),
            r.transaction_id,
            r.customer || "Walk-in",
            (r.payment_method || "—").toUpperCase(),
            money(r.amount, r.currency),
            usd(r.amount_usd),
            (r.status || "COMPLETED").toUpperCase(),
          ]),
      alignRight: useAll ? [4, 6, 7] : [4, 5],
      weights: useAll ? [8, 15, 12, 10, 12, 8, 8, 12, 9] : [9, 18, 14, 12, 13, 14, 10],
      wrap: [1, 2],
      contentWidth: PAGE.landscape.contentW,
      fontSize: 8,
      headerFontSize: 7.5,
      padding: 2,
      keepRows: true,
    }),
    totalsBlock([
      { label: "Total Payments", value: money((data?.totals?.total_usd) ?? 0, "USD"), strong: true },
      { label: "USD Payments", value: money((data?.totals?.total_usd) ?? 0, "USD") },
      ...(sspTotal > 0 ? [{ label: "SSP Payments", value: ssp(sspTotal) }] : []),
      { label: "Payment Count", value: String((data?.totals?.count) ?? 0) },
    ]),
    ...approvalBlock(),
    { text: "DAHAV Business Management System • Original payment currency is preserved; USD equivalents use the recorded payment rate.", style: "footerNote" },
  ];
  return doc;
}

export interface InventoryReportRow {
  sku: string; name: string; category: string; stock: number; low_stock_threshold: number;
  unit_cost: number; unit_price: number; inventory_value: number; status: string;
}

export function inventoryPdf(ctx: DocContext, data: { rows: InventoryReportRow[]; totals: Record<string, number> }): DocDef {
  const doc = baseDoc({ ...ctx, orientation: "landscape" });
  doc.content = [
    ...headerBlock({ ...ctx, orientation: "landscape" }),
    ...metricBar([
      { label: "Products", value: String((data?.totals?.total_products) ?? 0) },
      { label: "Units", value: String((data?.totals?.total_units) ?? 0) },
      { label: "Inventory Value", value: usd((data?.totals?.total_value) ?? 0) },
      { label: "Low Stock", value: String((data.rows || []).filter((r) => r.status === "LOW STOCK").length) },
      { label: "Out of Stock", value: String((data.rows || []).filter((r) => r.status === "OUT OF STOCK").length) },
      { label: "Damaged Units", value: String((data as { damaged_units?: number }).damaged_units ?? 0) },
    ]),
    ruleTable({
      headers: ["Product", "Category", "Stock", "Unit Cost", "Selling Price", "Inventory Value", "Status"],
      rows: (data.rows || []).map((r) => [
        r.name, r.category || "—", String(r.stock),
        usd(r.unit_cost), usd(r.unit_price), usd(r.inventory_value), r.status,
      ]),
      alignRight: [2, 3, 4, 5],
      weights: [22, 14, 9, 12, 13, 14, 11],
      wrap: [0, 1],
      contentWidth: PAGE.landscape.contentW,
      fontSize: 8,
      headerFontSize: 7.5,
      padding: 2,
      keepRows: true,
    }),
    totalsBlock([
      { label: "Products", value: String((data?.totals?.total_products) ?? 0) },
      { label: "Units in Stock", value: String((data?.totals?.total_units) ?? 0) },
      { label: "Inventory Value", value: usd((data?.totals?.total_value) ?? 0), strong: true },
    ]),
    ...approvalBlock(),
    { text: "DAHAV Business Management System • No unrelated currency columns are shown.", style: "footerNote" },
  ];
  return doc;
}

export interface EmployeeRow {
  payroll_id: string; employee: string; period: string; net_salary: number; currency: string;
  amount_usd: number; status: string; transaction_id: string; date: string;
}

export function employeesPdf(ctx: DocContext, data: { rows: EmployeeRow[]; totals: Record<string, number> }): DocDef {
  const doc = baseDoc({ ...ctx, orientation: "landscape" });
  const rows = (data.rows || []).map((r) => ({ ...r, currency: r.currency || "USD" }));
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  const metrics: Array<{ label: string; value: string }> = [
    { label: "Employees", value: String(data.totals.employees ?? (data?.totals?.count) ?? 0) },
    { label: "Payroll This Period", value: money((data?.totals?.total_usd) ?? 0, "USD") },
    { label: "Paid", value: money((data?.totals?.total_usd) ?? 0, "USD") },
  ];
  if (sspTotal > 0) metrics.push({ label: "SSP Total", value: ssp(sspTotal) });
  doc.content = [
    ...headerBlock({ ...ctx, orientation: "landscape" }),
    ...metricBar(metrics),
    ruleTable({
      headers: ["Employee", "Period", "Net Salary", "Currency", "USD Equivalent", "Status", "Transaction ID"],
      rows: rows.map((r) => [
        r.employee, r.period || "—",
        money(r.net_salary, r.currency),
        r.currency,
        usd(r.amount_usd),
        (r.status || "PAID").toUpperCase(),
        r.transaction_id,
      ]),
      alignRight: [2, 4],
      weights: [16, 14, 13, 10, 14, 10, 15],
      wrap: [0, 1, 6],
      contentWidth: PAGE.landscape.contentW,
      fontSize: 8,
      headerFontSize: 7.5,
      padding: 2,
      keepRows: true,
    }),
    totalsBlock([
      { label: "Payroll This Period", value: money((data?.totals?.total_usd) ?? 0, "USD"), strong: true },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
      { label: "Payroll Count", value: String((data?.totals?.count) ?? 0) },
    ]),
    ...approvalBlock(),
    { text: "DAHAV Business Management System • Salary currency is shown only when relevant to the underlying payroll data.", style: "footerNote" },
  ];
  return doc;
}

/* ------------------------------------------------------------------ *
 * Receipt PDF (from the receipt snapshot in the database)
 * ------------------------------------------------------------------ */

export interface ReceiptPdfData {
  company?: { company_name?: string; address?: string; phone?: string; email?: string; tax_id?: string };
  receipt_id: string; invoice_id?: string; sale_id?: string; transaction_id?: string;
  date?: string; customer?: string; cashier?: string;
  items?: Array<{ product_name: string; quantity: number; unit_price: number; line_total: number }>;
  subtotal?: number; discount?: number; total?: number; amount_due?: number; amount_paid?: number; amount_usd?: number;
  payment_currency?: string; exchange_rate?: number; tendered?: number; change?: number;
  payment_method?: string; transaction_status?: string;
  outstanding?: number; total_paid?: number;
  outstanding_ccy?: number; total_paid_ccy?: number;
  payments?: Array<{ payment_id: string; amount: number; currency: string; amount_usd: number; date: string }>;
}

export function receiptPdf(data: ReceiptPdfData): DocDef {
  const ctx: DocContext = {
    company: {
      company_name: data.company?.company_name || "DAHAV General Trading Co. Ltd",
      address: data.company?.address || "",
      phone: data.company?.phone || "",
      email: data.company?.email || "",
      tax_id: data.company?.tax_id || "",
    },
    reportTitle: "RECEIPT",
    periodLabel: "",
    generatedAt: "",
    currency: "USD",
  };
  const doc = baseDoc(ctx);
  const paidAt = data.date ? new Date(data.date) : new Date();
  const paidLabel = paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const cur = (data.payment_currency || "USD").toUpperCase();
  // AMOUNT PAID is the actual payment received, in payment currency.
  const amountPaid = cur === "SSP"
    ? (data.amount_paid ?? data.amount_usd ?? 0)
    : (data.amount_paid ?? data.amount_usd ?? data.total ?? 0);
  const amountDue = cur === "SSP" ? (data.amount_due ?? 0) : (data.total ?? 0);
  // Outstanding in the payment currency (exact), falling back to USD.
  const outstandingVal = cur === "SSP"
    ? (data.outstanding_ccy ?? data.outstanding ?? 0)
    : (data.outstanding ?? data.outstanding_ccy ?? 0);
  const status = (data.transaction_status || (Number(outstandingVal) > 0 ? "partial" : "completed")).toUpperCase();
  const paidText = `${cur === "SSP" ? ssp(amountPaid) : usd(amountPaid)} paid on ${paidLabel}`;

  doc.content = [
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.9, lineColor: "#111827" }], margin: [0, 0, 0, 10] },
    { text: ctx.company.company_name, style: "companyName" },
    ...(ctx.company.address ? [{ text: ctx.company.address, fontSize: 8.5, color: "#6b7280", margin: [0, 1, 0, 0] }] : []),
    ...(ctx.company.phone ? [{ text: ctx.company.phone, fontSize: 8.5, color: "#6b7280", margin: [0, 1, 0, 0] }] : []),
    ...(ctx.company.email ? [{ text: ctx.company.email, fontSize: 8.5, color: "#6b7280", margin: [0, 1, 0, 0] }] : []),
    ...(ctx.company.tax_id ? [{ text: `Tax ID: ${ctx.company.tax_id}`, fontSize: 8.5, color: "#6b7280", margin: [0, 1, 0, 0] }] : []),
    hrDouble(),
    { text: "RECEIPT", style: "reportTitle" },
    {
      columns: [
        {
          stack: [
            { text: "Invoice No", style: "tableHeader" },
            { text: data.invoice_id || data.sale_id || "—", fontSize: 9 },
            { text: "Receipt No", style: "tableHeader", margin: [0, 6, 0, 0] },
            { text: data.receipt_id, fontSize: 9 },
            { text: "Date paid", style: "tableHeader", margin: [0, 6, 0, 0] },
            { text: paidLabel, fontSize: 9 },
          ],
        },
        {
          stack: [
            { text: "BILL TO", style: "tableHeader" },
            { text: data.customer || "Walk-in Customer", fontSize: 9 },
            { text: "CASHIER", style: "tableHeader", margin: [0, 6, 0, 0] },
            { text: data.cashier || "—", fontSize: 9 },
          ],
          alignment: "right",
        },
      ],
      margin: [0, 12, 0, 14],
    },
    // Large prominent "$X paid on date"
    { text: paidText, fontSize: 20, bold: true, color: "#111827", margin: [0, 6, 0, 16] },
    ruleTable({
      headers: ["Description", "Qty", "Unit Price", "Amount"],
      rows: (data.items || []).map((i) => [
        i.product_name, String(i.quantity), usd(i.unit_price ?? 0), usd(i.line_total ?? i.quantity * (i.unit_price ?? 0)),
      ]),
      alignRight: [1, 2, 3],
      weights: [10, 3, 4, 4],
      wrap: [0],
      keepRows: true,
    }),
    totalsBlock([
      { label: "Subtotal", value: usd(data.subtotal ?? 0) },
      ...(Number(data.discount) > 0 ? [{ label: "Discount", value: `−${usd(data.discount ?? 0)}` }] : []),
      { label: "Total", value: usd(data.total ?? data.amount_usd ?? 0), strong: true },
      { label: "Amount Due", value: cur === "SSP" ? ssp(amountDue) : usd(amountDue) },
      { label: "Amount Paid", value: cur === "SSP" ? ssp(amountPaid) : usd(amountPaid), strong: true },
      ...(Number(data.change) > 0 ? [{ label: "Change", value: cur === "SSP" ? ssp(data.change ?? 0) : usd(data.change ?? 0) }] : []),
      ...(Number(outstandingVal) > 0 ? [{ label: "Outstanding", value: cur === "SSP" ? ssp(outstandingVal) : usd(outstandingVal), strong: true }] : []),
      { label: "Status", value: status },
    ]),
    hrDouble(),
  ];

  // Payment history
  if (data.payments && data.payments.length) {
    doc.content.push(
      { text: "PAYMENT HISTORY", style: "reportTitle", margin: [0, 0, 0, 6] },
      ruleTable({
        headers: ["Payment ID", "Date", "Amount", "Currency", "USD Equivalent"],
        rows: data.payments.map((p) => [
          p.payment_id,
          new Date(p.date).toLocaleDateString("en-GB"),
          p.currency === "SSP" ? ssp(p.amount) : usd(p.amount),
          p.currency,
          usd(p.amount_usd),
        ]),
        alignRight: [2, 4],
        weights: [7, 4, 4, 3, 4],
        wrap: [0],
        keepRows: true,
      }),
    );
  }

  // Footer: transaction ID, cashier, status
  doc.content.push(
    {
      columns: [
        { stack: [{ text: "TRANSACTION ID", style: "tableHeader" }, { text: data.transaction_id || "—", fontSize: 9 }] },
        { stack: [{ text: "CASHIER", style: "tableHeader" }, { text: data.cashier || "—", fontSize: 9 }] },
        { stack: [{ text: "STATUS", style: "tableHeader" }, { text: status, fontSize: 9 }] },
      ],
      margin: [0, 12, 0, 0],
    },
    ...receiptApprovalBlock(),
    { text: "DAHAV Business Management System • Generated from authoritative persisted business data.", style: "footerNote" },
  );
  return doc;
}

/* ------------------------------------------------------------------ *
 * Generation helpers
 * ------------------------------------------------------------------ */

/** Generate the PDF blob from a doc definition. */
export async function generatePdf(doc: DocDef): Promise<Blob> {
  const pdfDoc: TCreatedPdf = pdfmake.createPdf(doc as TDocumentDefinitions);
  return pdfDoc.getBlob();
}

/** Download a generated PDF with a filename. */
export async function downloadPdf(doc: DocDef, filename: string) {
  const blob = await generatePdf(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open the PDF in a new tab (browser PDF viewer) then trigger print. */
export async function printPdf(doc: DocDef, title: string) {
  const blob = await generatePdf(doc);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (w) {
    w.document.title = title;
    // Give the viewer a moment to load before printing
    w.addEventListener("load", () => {
      setTimeout(() => w.print(), 300);
    });
  }
}

/** Shared context from company settings + period. */
export async function buildContext(reportTitle: string, periodLabel: string): Promise<DocContext> {
  const pb = getPb();
  const s = await pb.collection("settings").getFullList<{ company_name: string; address: string; phone: string; email: string; tax_id: string; currency: string }>();
  const settings = s[0];
  return {
    company: {
      company_name: settings?.company_name || "",
      address: settings?.address || "",
      phone: settings?.phone || "",
      email: settings?.email || "",
      tax_id: settings?.tax_id || "",
    },
    reportTitle,
    periodLabel,
    generatedAt: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    currency: settings?.currency || "USD",
  };
}

/** Fetch a report endpoint with auth (same source as the web report). */
export async function fetchReport<T>(path: string, params?: Record<string, string>): Promise<T> {
  const pb = getPb();
  const qs = new URLSearchParams(params || {}).toString();
  const res = await fetch(`${pb.baseUrl}${path}${qs ? "?" + qs : ""}`, {
    headers: pb.authStore.token ? { Authorization: pb.authStore.token } : {},
  });
  if (!res.ok) throw new Error("Failed to load report data");
  return res.json();
}

export { rateLabel };
