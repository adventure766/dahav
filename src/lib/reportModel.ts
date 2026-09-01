/**
 * DAHAV shared structured-report model.
 *
 * Single source of truth for how report rows/totals are SHAPED and FORMATTED
 * for display in the web table, PDF renderer and Excel renderer. The data
 * itself always comes from the server report endpoints (the authoritative
 * calculation engine) — this module only decides columns, currency labels,
 * and per-row/per-total rendering so the three outputs can never drift.
 *
 * Currency rules (applied identically everywhere):
 *  - USD and SSP are first-class. An amount is NEVER relabelled.
 *  - USD + SSP are never summed together; totals are grouped per currency.
 *  - A selected "reporting currency" (All/USD/SSP) only filters which rows
 *    are shown and which single currency is used for P&L — it never converts
 *    or invents amounts.
 */

/** A row in any financial report. */
export interface FinRow {
  date?: string;
  id?: string;
  transaction_id?: string;
  customer?: string;
  cashier?: string;
  description?: string;
  category?: string;
  method?: string;
  /** Original amount in its own currency. */
  amount: number;
  /** Original currency of the row. */
  currency: string;
  /** Historical rate recorded with the transaction. */
  exchange_rate?: number;
  /** Converted USD reporting amount. */
  amount_usd?: number;
  /** For SSP rows, its SSP equivalent (== amount). */
  amount_ssp?: number;
  paid?: number;
  outstanding?: number;
  status?: string;
  quantity?: number;
}

/** A column definition shared by web table, PDF and Excel. */
export interface RepCol {
  key: string;
  label: string;
  /** Right-align numeric/currency columns. */
  right?: boolean;
  /** Which column provides the currency for formatting (default: row.currency). */
  currencyKey?: string;
}

/** A totals line: label + per-currency value(s). */
export interface TotLine {
  label: string;
  /** Currency of this total; "MIXED" renders separate per-currency totals. */
  currency?: string;
  amount?: number;
  /** For MIXED: separate totals per currency. */
  byCurrency?: Array<{ currency: string; amount: number }>;
  strong?: boolean;
}

export type CurrencyView = "all" | "USD" | "SSP";

/** Build financial report columns for a currency view (sales/expenses/payments/payroll). */
export function financialColumns(view: CurrencyView): RepCol[] {
  if (view === "all") {
    return [
      { key: "date", label: "Date" },
      { key: "id", label: "ID" },
      { key: "transaction_id", label: "Transaction ID" },
      { key: "customer", label: "Customer" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "amount", label: "Original Amount", right: true, currencyKey: "currency" },
      { key: "paid", label: "Paid", right: true, currencyKey: "currency" },
      { key: "outstanding", label: "Outstanding", right: true, currencyKey: "currency" },
      { key: "currency", label: "Currency" },
      { key: "exchange_rate", label: "Exchange Rate", right: true },
      { key: "amount_usd", label: "USD Equivalent", right: true },
      { key: "payment_currency", label: "Payment Currency" },
      { key: "status", label: "Status" },
    ];
  }
  const suffix = view === "USD" ? " (USD)" : " (SSP)";
  return [
    { key: "date", label: "Date" },
    { key: "id", label: "ID" },
    { key: "transaction_id", label: "Transaction ID" },
    { key: "customer", label: "Customer" },
    { key: "description", label: "Description" },
    { key: "category", label: "Category" },
    { key: "amount", label: `Amount${suffix}`, right: true, currencyKey: "currency" },
    { key: "paid", label: `Paid${suffix}`, right: true, currencyKey: "currency" },
    { key: "outstanding", label: `Outstanding${suffix}`, right: true, currencyKey: "currency" },
    { key: "payment_currency", label: "Payment Currency" },
    { key: "status", label: "Status" },
  ];
}

/** P&L uses a single selected reporting currency. */
export interface PnlLines {
  revenue: number;
  cogs: number;
  gross_profit: number;
  operating_expenses: number;
  other_income: number;
  other_losses: number;
  net_profit: number;
  currency: string;
}

/** Inventory/product rows (a product has ONE currency). */
export interface InvRow {
  product_id?: string;
  name: string;
  sku?: string;
  category?: string;
  stock: number;
  unit_cost: number;
  unit_price: number;
  inventory_value: number;
  low_stock_threshold?: number;
  currency: string;
  status?: string;
}

/** Damage rows are valued in the product's currency. */
export interface DamageRow {
  damage_id?: string;
  transaction_id?: string;
  date?: string;
  product?: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reason?: string;
  currency: string;
}

/** Customer debt rows are USD reporting values (debt ledger is USD-based). */
export interface DebtRow {
  name: string;
  phone?: string;
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  credit: number;
  currency?: string;
}

/** Filter financial rows by a currency view. */
export function filterByView(rows: FinRow[], view: CurrencyView): FinRow[] {
  if (view === "all") return rows;
  return rows.filter((r) => (r.currency || "USD").toUpperCase() === view);
}

/** True if a currency is SSP (case-insensitive). */
export function isSsp(c: string | undefined): boolean {
  return (c || "USD").toUpperCase() === "SSP";
}

/** Amount in its own currency (the original amount IS the SSP amount for SSP rows). */
export function amountInCurrency(r: FinRow): number {
  return Number(r.amount) || 0;
}

/** USD equivalent of a row (already converted by the engine at write time). */
export function usdOf(r: FinRow): number {
  return Number(r.amount_usd) ?? Number(r.amount) ?? 0;
}

/**
 * Group totals per currency from a set of rows. Never sums USD + SSP.
 */
export function totalsByCurrency(rows: FinRow[], mapper: (r: FinRow) => number): Array<{ currency: string; amount: number }> {
  const out: Array<{ currency: string; amount: number }> = [];
  const byCur: Record<string, number> = {};
  for (const r of rows) {
    const c = (r.currency || "USD").toUpperCase();
    byCur[c] = (byCur[c] || 0) + (mapper(r) || 0);
  }
  for (const c of Object.keys(byCur)) {
    out.push({ currency: c, amount: byCur[c] });
  }
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}
