/**
 * DAHAV Excel (.xlsx) export.
 *
 * Generates a real Excel workbook from the SAME structured report data the
 * PDF renderer and web report use. No independent calculations — totals,
 * transaction IDs, currencies and dates all come from the report data, so
 * Excel total == PDF total == web report total.
 *
 * Formatting per spec: freeze header row, auto-filter, proper column widths,
 * real numeric/date cells, currency + number formats, bold headers, totals,
 * print area, landscape, fit-to-1-page-wide, repeating header rows on print.
 */
import ExcelJS from "exceljs";
import { getPb } from "./pb";
import { usd, ssp } from "./currency";
import type {
  SalesReportRow, ExpenseReportRow, PnlData, PaymentReportRow,
  InventoryReportRow, EmployeeRow, DocContext,
} from "./pdf";

const NUM = "#,##0.00";
const USD_FMT = '"$"#,##0.00';
const DATE_FMT = "dd mmm yyyy";

interface Column {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
  align?: "left" | "right";
}

/** Style a header row: bold, gray fill, border. */
function styleHeader(ws: ExcelJS.Worksheet, rowIndex: number, nCols: number) {
  const row = ws.getRow(rowIndex);
  row.height = 20;
  for (let c = 1; c <= nCols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: "FF1F2937" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
    };
  }
}

/** Shared report scaffold: title block + summary + data table + totals. */
export interface ExcelReportSpec {
  title: string;
  periodLabel: string;
  sheetName: string;
  columns: Column[];
  rows: Array<Array<string | number | Date | null>>;
  summary: Array<{ label: string; value: string }>;
  totals: Array<{ label: string; value: string | number; bold?: boolean }>;
  currency: string;
}

export function buildReportWorkbook(spec: ExcelReportSpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DAHAV Business Management System";
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      horizontalCentered: false,
    },
  });

  const nCols = spec.columns.length;

  // Title block
  ws.mergeCells(1, 1, 1, nCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "DAHAV General Trading Co. Ltd";
  titleCell.font = { bold: true, size: 14, color: { argb: "FF111827" } };

  ws.mergeCells(2, 1, 2, nCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = spec.title;
  subCell.font = { bold: true, size: 11, color: { argb: "FF374151" } };

  ws.mergeCells(3, 1, 3, nCols);
  ws.getCell(3, 1).value = `Reporting Period: ${spec.periodLabel}`;
  ws.getCell(3, 1).font = { size: 9, color: { argb: "FF6B7280" } };

  ws.mergeCells(4, 1, 4, nCols);
  ws.getCell(4, 1).value = `Generated: ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  ws.getCell(4, 1).font = { size: 9, color: { argb: "FF6B7280" } };

  // Summary row (5)
  const sumRow = ws.getRow(5);
  sumRow.height = 16;
  spec.summary.forEach((s, i) => {
    const col = 1 + i * 2;
    const cell = sumRow.getCell(col);
    cell.value = s.label + ":";
    cell.font = { size: 9, color: { argb: "FF374151" } };
    const v = sumRow.getCell(col + 1);
    v.value = s.value;
    v.font = { bold: true, size: 9, color: { argb: "FF111827" } };
  });

  // Column headers at row 7
  const headerRowIndex = 7;
  spec.columns.forEach((c, i) => {
    const cell = ws.getCell(headerRowIndex, i + 1);
    cell.value = c.header.toUpperCase();
    cell.font = { bold: true, size: 9, color: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "middle", horizontal: c.align === "right" ? "right" : "left", wrapText: true };
  });
  styleHeader(ws, headerRowIndex, nCols);

  // Data rows
  const dataStart = headerRowIndex + 1;
  spec.rows.forEach((r, ri) => {
    const row = ws.getRow(dataStart + ri);
    spec.columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const val = r[ci];
      if (val instanceof Date) {
        cell.value = val;
        cell.numFmt = c.numFmt || DATE_FMT;
      } else if (typeof val === "number") {
        cell.value = val;
        cell.numFmt = c.numFmt || NUM;
      } else {
        cell.value = val ?? "";
      }
      cell.alignment = { vertical: "middle", horizontal: c.align === "right" ? "right" : "left" };
      cell.font = { size: 9, color: { argb: "FF1F2430" } };
    });
    row.height = 15;
  });

  // Column widths
  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // Totals block
  const totalStart = dataStart + spec.rows.length + 1;
  spec.totals.forEach((t, i) => {
    const row = ws.getRow(totalStart + i);
    const label = row.getCell(1);
    label.value = t.label;
    label.font = { bold: !!t.bold, size: 10, color: { argb: "FF111827" } };
    const val = row.getCell(nCols);
    if (typeof t.value === "number") {
      val.value = t.value;
      val.numFmt = USD_FMT;
    } else {
      val.value = t.value;
    }
    val.font = { bold: !!t.bold, size: 10, color: { argb: "FF111827" } };
    val.alignment = { horizontal: "right" };
  });

  // Auto-filter on the data table
  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: dataStart + Math.max(spec.rows.length - 1, 0), column: nCols },
  };

  // Print: repeat header rows
  ws.pageSetup.printTitlesRow = `${headerRowIndex}:${headerRowIndex}`;
  ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + nCols)}${totalStart + spec.totals.length}`;

  return wb;
}

/** Convert a workbook to a Blob (browser). */
export async function workbookToBlob(wb: ExcelJS.Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Download a workbook as .xlsx */
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const blob = await workbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Map a date string from the report data to a real Date (preserve as-is). */
function parseDate(d: string): Date {
  const dt = new Date(String(d).replace(" ", "T"));
  return isNaN(dt.getTime()) ? new Date() : dt;
}

/* ------------------------------------------------------------------ *
 * Report builders — same data as the PDF/web reports
 * ------------------------------------------------------------------ */

export function salesExcel(ctx: DocContext, data: { rows: SalesReportRow[]; totals: Record<string, number> }): ExcelJS.Workbook {
  const rows = (data.rows || []).map((r) => ({
    ...r,
    currency: (r as unknown as { original_currency?: string }).original_currency || "USD",
    exchange_rate: (r as unknown as { exchange_rate?: number }).exchange_rate || 0,
  }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  const columns: Column[] = useAll ? [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Customer", key: "customer", width: 16 },
    { header: "Cashier", key: "cashier", width: 14 },
    { header: "Original Amount", key: "amount", width: 14, numFmt: NUM, align: "right" },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Exchange Rate", key: "rate", width: 12, numFmt: NUM, align: "right" },
    { header: "Reporting", key: "reporting", width: 14, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ] : [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Customer", key: "customer", width: 16 },
    { header: "Cashier", key: "cashier", width: 14 },
    { header: "Total", key: "total", width: 12, numFmt: USD_FMT, align: "right" },
    { header: "Paid", key: "paid", width: 12, numFmt: USD_FMT, align: "right" },
    { header: "Outstanding", key: "outstanding", width: 12, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ];
  return buildReportWorkbook({
    title: "SALES REPORT",
    periodLabel: ctx.periodLabel,
    sheetName: "Sales Report",
    currency: ctx.currency,
    columns,
    summary: [
      { label: "Sales", value: usd((data?.totals?.total_sales) ?? 0) },
      { label: "Paid", value: usd((data?.totals?.total_paid) ?? 0) },
      { label: "Outstanding", value: usd((data?.totals?.total_outstanding) ?? 0) },
      { label: "Units", value: String((data?.totals?.total_quantity) ?? 0) },
      { label: "Transactions", value: String((data?.totals?.count) ?? 0) },
    ],
    rows: useAll
      ? rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.customer || "Walk-in", r.cashier || "—",
          r.total, r.currency, r.exchange_rate || null, r.total, r.status.toUpperCase(),
        ])
      : rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.customer || "Walk-in", r.cashier || "—",
          r.total, r.amount_paid, r.amount_outstanding, r.status.toUpperCase(),
        ]),
    totals: [
      { label: "Total Sales", value: (data?.totals?.total_sales) ?? 0, bold: true },
      { label: "Total Paid", value: (data?.totals?.total_paid) ?? 0 },
      { label: "Outstanding", value: (data?.totals?.total_outstanding) ?? 0 },
      { label: "Sales Count", value: (data?.totals?.count) ?? 0 },
    ],
  });
}

export function expensesExcel(ctx: DocContext, data: { rows: ExpenseReportRow[]; totals: Record<string, number> }): ExcelJS.Workbook {
  const rows = (data.rows || []).map((r) => ({ ...r, currency: r.currency || "USD" }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  const columns: Column[] = useAll ? [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Category", key: "category", width: 14 },
    { header: "Description", key: "description", width: 26 },
    { header: "Method", key: "method", width: 12 },
    { header: "Original Amount", key: "amount", width: 14, numFmt: NUM, align: "right" },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Exchange Rate", key: "rate", width: 12, numFmt: NUM, align: "right" },
    { header: "Reporting", key: "reporting", width: 14, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ] : [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Category", key: "category", width: 14 },
    { header: "Description", key: "description", width: 26 },
    { header: "Method", key: "method", width: 12 },
    { header: "Amount", key: "amount", width: 14, numFmt: USD_FMT, align: "right" },
    { header: "USD", key: "usd", width: 14, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ];
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  return buildReportWorkbook({
    title: "EXPENSES REPORT",
    periodLabel: ctx.periodLabel,
    sheetName: "Expenses Report",
    currency: ctx.currency,
    columns,
    summary: [
      { label: "Expenses", value: usd((data?.totals?.total_usd) ?? 0) },
      { label: "Expense Count", value: String((data?.totals?.count) ?? 0) },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
    ],
    rows: useAll
      ? rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.category || "—", r.description || "—",
          (r.payment_method || "—").toUpperCase(),
          r.amount, r.currency, r.exchange_rate || null, r.amount_usd, (r.status || "COMPLETED").toUpperCase(),
        ])
      : rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.category || "—", r.description || "—",
          (r.payment_method || "—").toUpperCase(),
          r.amount, r.amount_usd, (r.status || "COMPLETED").toUpperCase(),
        ]),
    totals: [
      { label: "Total Expenses", value: (data?.totals?.total_usd) ?? 0, bold: true },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
      { label: "Expense Count", value: (data?.totals?.count) ?? 0 },
    ],
  });
}

export function pnlExcel(ctx: DocContext, data: PnlData): ExcelJS.Workbook {
  const rc = (data as unknown as { reporting_currency?: string }).reporting_currency || "USD";
  const isSsp = rc.toUpperCase() === "SSP";
  const FMT = isSsp ? '\\#,##0\\ "SSP"' : USD_FMT;
  const columns: Column[] = [
    { header: "Period", key: "period", width: 16 },
    { header: "Revenue", key: "revenue", width: 14, numFmt: FMT, align: "right" },
    { header: "COGS", key: "cogs", width: 14, numFmt: FMT, align: "right" },
    { header: "Gross Profit", key: "gross", width: 14, numFmt: FMT, align: "right" },
    { header: "Operating Expenses", key: "opex", width: 18, numFmt: FMT, align: "right" },
    { header: "Other Income", key: "income", width: 14, numFmt: FMT, align: "right" },
    { header: "Other Loss", key: "loss", width: 14, numFmt: FMT, align: "right" },
    { header: "Net Profit", key: "net", width: 14, numFmt: FMT, align: "right" },
  ];
  const rows = data.rows?.length
    ? data.rows.map((r) => [r.label, r.revenue, r.cogs, r.gross_profit, r.operating_expenses, r.other_income, r.other_losses, r.net_profit])
    : [["Period", data.revenue, data.cogs, data.gross_profit, data.operating_expenses, data.other_income, data.other_losses, data.net_profit]];
  return buildReportWorkbook({
    title: `INCOME & PROFIT / LOSS REPORT (${rc})`,
    periodLabel: ctx.periodLabel,
    sheetName: "Income & P&L",
    currency: rc,
    columns,
    summary: [
      { label: "Revenue", value: isSsp ? ssp(data.revenue) : usd(data.revenue) },
      { label: "COGS", value: isSsp ? ssp(data.cogs) : usd(data.cogs) },
      { label: "Gross Profit", value: isSsp ? ssp(data.gross_profit) : usd(data.gross_profit) },
      { label: "Expenses", value: isSsp ? ssp(data.operating_expenses) : usd(data.operating_expenses) },
      { label: "Net Profit", value: isSsp ? ssp(data.net_profit) : usd(data.net_profit) },
    ],
    rows: rows as Array<Array<string | number | Date | null>>,
    totals: [
      { label: "Revenue", value: data.revenue },
      { label: "COGS", value: data.cogs },
      { label: "Gross Profit", value: data.gross_profit, bold: true },
      { label: "Operating Expenses", value: data.operating_expenses },
      { label: "Net Profit", value: data.net_profit, bold: true },
    ],
  });
}

export function paymentsExcel(ctx: DocContext, data: { rows: PaymentReportRow[]; totals: Record<string, number> }): ExcelJS.Workbook {
  const rows = (data.rows || []).map((r) => ({ ...r, currency: r.currency || "USD" }));
  const hasMixed = rows.some((r) => r.currency !== rows[0]?.currency);
  const useAll = hasMixed;
  const columns: Column[] = useAll ? [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Customer", key: "customer", width: 16 },
    { header: "Method", key: "method", width: 13 },
    { header: "Original Amount", key: "amount", width: 16, numFmt: NUM, align: "right" },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Exchange Rate", key: "rate", width: 12, numFmt: NUM, align: "right" },
    { header: "USD Equivalent", key: "usd", width: 15, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ] : [
    { header: "Date", key: "date", width: 13 },
    { header: "Transaction ID", key: "transaction_id", width: 22 },
    { header: "Customer", key: "customer", width: 16 },
    { header: "Method", key: "method", width: 13 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM, align: "right" },
    { header: "USD Equivalent", key: "usd", width: 15, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ];
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  return buildReportWorkbook({
    title: "PAYMENTS REPORT",
    periodLabel: ctx.periodLabel,
    sheetName: "Payments Report",
    currency: ctx.currency,
    columns,
    summary: [
      { label: "Total Payments", value: usd((data?.totals?.total_usd) ?? 0) },
      { label: "USD Payments", value: usd((data?.totals?.total_usd) ?? 0) },
      ...(sspTotal > 0 ? [{ label: "SSP Payments", value: ssp(sspTotal) }] : []),
      { label: "Payment Count", value: String((data?.totals?.count) ?? 0) },
    ],
    rows: useAll
      ? rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.customer || "Walk-in",
          (r.payment_method || "—").toUpperCase(),
          r.amount, r.currency, r.exchange_rate || null, r.amount_usd, (r.status || "COMPLETED").toUpperCase(),
        ])
      : rows.map((r) => [
          parseDate(r.date), r.transaction_id, r.customer || "Walk-in",
          (r.payment_method || "—").toUpperCase(),
          r.amount, r.amount_usd, (r.status || "COMPLETED").toUpperCase(),
        ]),
    totals: [
      { label: "Total Payments", value: (data?.totals?.total_usd) ?? 0, bold: true },
      { label: "USD Payments", value: (data?.totals?.total_usd) ?? 0 },
      ...(sspTotal > 0 ? [{ label: "SSP Payments", value: ssp(sspTotal) }] : []),
      { label: "Payment Count", value: (data?.totals?.count) ?? 0 },
    ],
  });
}

export function inventoryExcel(ctx: DocContext, data: { rows: InventoryReportRow[]; totals: Record<string, number> }): ExcelJS.Workbook {
  const columns: Column[] = [
    { header: "Product", key: "name", width: 26 },
    { header: "Category", key: "category", width: 14 },
    { header: "Stock", key: "stock", width: 10, numFmt: "#,##0", align: "right" },
    { header: "Unit Cost", key: "cost", width: 12, numFmt: USD_FMT, align: "right" },
    { header: "Selling Price", key: "price", width: 13, numFmt: USD_FMT, align: "right" },
    { header: "Inventory Value", key: "value", width: 15, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
  ];
  return buildReportWorkbook({
    title: "PRODUCTS / INVENTORY REPORT",
    periodLabel: ctx.periodLabel,
    sheetName: "Inventory Report",
    currency: ctx.currency,
    columns,
    summary: [
      { label: "Products", value: String((data?.totals?.total_products) ?? 0) },
      { label: "Units", value: String((data?.totals?.total_units) ?? 0) },
      { label: "Inventory Value", value: usd((data?.totals?.total_value) ?? 0) },
      { label: "Low Stock", value: String((data.rows || []).filter((r) => r.status === "LOW STOCK").length) },
      { label: "Out of Stock", value: String((data.rows || []).filter((r) => r.status === "OUT OF STOCK").length) },
      { label: "Damaged Units", value: String((data as { damaged_units?: number }).damaged_units ?? 0) },
    ],
    rows: (data.rows || []).map((r) => [
      r.name, r.category || "—", r.stock,
      r.unit_cost, r.unit_price, r.inventory_value, r.status,
    ]),
    totals: [
      { label: "Products", value: (data?.totals?.total_products) ?? 0 },
      { label: "Units in Stock", value: (data?.totals?.total_units) ?? 0 },
      { label: "Inventory Value", value: (data?.totals?.total_value) ?? 0, bold: true },
    ],
  });
}

export function employeesExcel(ctx: DocContext, data: { rows: EmployeeRow[]; totals: Record<string, number> }): ExcelJS.Workbook {
  const columns: Column[] = [
    { header: "Employee", key: "employee", width: 18 },
    { header: "Period", key: "period", width: 14 },
    { header: "Net Salary", key: "salary", width: 14, numFmt: USD_FMT, align: "right" },
    { header: "Currency", key: "currency", width: 10 },
    { header: "USD Equivalent", key: "usd", width: 15, numFmt: USD_FMT, align: "right" },
    { header: "Status", key: "status", width: 12 },
    { header: "Transaction ID", key: "tx", width: 20 },
  ];
  const sspTotal = (data?.totals?.total_ssp) ?? 0;
  return buildReportWorkbook({
    title: "EMPLOYEE / PAYROLL REPORT",
    periodLabel: ctx.periodLabel,
    sheetName: "Employee Report",
    currency: ctx.currency,
    columns,
    summary: [
      { label: "Employees", value: String(data.totals.employees ?? (data?.totals?.count) ?? 0) },
      { label: "Payroll This Period", value: usd((data?.totals?.total_usd) ?? 0) },
      { label: "Paid", value: usd((data?.totals?.total_usd) ?? 0) },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
    ],
    rows: (data.rows || []).map((r) => [
      r.employee, r.period || "—",
      r.currency === "SSP" ? r.net_salary : r.amount_usd,
      r.currency,
      r.amount_usd,
      (r.status || "PAID").toUpperCase(),
      r.transaction_id,
    ]),
    totals: [
      { label: "Payroll This Period", value: (data?.totals?.total_usd) ?? 0, bold: true },
      ...(sspTotal > 0 ? [{ label: "SSP Total", value: ssp(sspTotal) }] : []),
      { label: "Payroll Count", value: (data?.totals?.count) ?? 0 },
    ],
  });
}

/** Fetch a report endpoint with auth (same source as PDF/web). */
export async function fetchExcelReport<T>(path: string, params?: Record<string, string>): Promise<T> {
  const pb = getPb();
  const qs = new URLSearchParams(params || {}).toString();
  const res = await fetch(`${pb.baseUrl}${path}${qs ? "?" + qs : ""}`, {
    headers: pb.authStore.token ? { Authorization: pb.authStore.token } : {},
  });
  if (!res.ok) throw new Error("Failed to load report data");
  return res.json();
}
