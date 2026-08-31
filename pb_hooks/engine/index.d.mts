/**
 * Type declarations for the ESM copy of the Calculation Engine (index.mjs).
 * The engine is authored as CJS (index.cjs) for PocketBase's goja runtime and
 * generated as identical ESM (index.mjs) for the frontend/Vite/Vitest.
 * A sync test (tests/engine-sync.test.ts) verifies they never drift.
 */
declare const engine: {
  MINOR: number;
  fromMinor: (n: number) => number;
  toMinor: (n: number) => number;
  roundMoney: (n: number) => number;
  roundHalfUp: (n: number) => number;
  sspToUsd: (amount: number, rate: number) => number;
  usdToSsp: (amount: number, rate: number) => number;
  toUsd: (amount: number, fromCurrency: "USD" | "SSP", rate: number) => number;
  fromUsd: (amountUsd: number, toCurrency: "USD" | "SSP", rate: number) => number;
  formatMoney: (n: number) => string;
  formatMoneyGrouped: (n: number) => string;
  formatWhole: (n: number) => string;
  formatCurrency: (amount: number, currency: "USD" | "SSP") => string;
  lineTotal: (price: number, qty: number) => number;
  cartTotals: (lines: Array<{ unit_price: number; quantity: number; discount?: number }>) => {
    subtotal: number;
    discount: number;
    total: number;
  };
  paymentTotals: (args: {
    total_usd: number;
    payment_currency: "USD" | "SSP";
    rate: number;
    tendered: number;
  }) => {
    total_usd: number;
    payment_currency: "USD" | "SSP";
    rate: number;
    amount_due: number;
    amount_usd: number;
    tendered: number;
    change: number;
  };
  actualPaidAmount: (args: { amount_due: number; tendered?: number; paid_amount?: number | null }) => {
    paid: number;
    tendered: number;
    change: number;
    due: number;
  };
  percentDiscount: (total: number, pct: number) => number;
  absoluteDiscount: (total: number, amount: number) => number;
  grossProfit: (revenue: number, cogs: number) => number;
  netProfit: (gross: number, expenses: number, losses: number) => number;
  damageCost: (qty: number, unitCost: number) => number;
  netSalary: (base: number, allowances: number, deductions: number) => number;
  generateId: (prefix: string, seq: number, dateKey?: string, dated?: boolean) => string;
  todayKey: (offsetDays?: number) => string;
  movingAverage: (onHand: number, avgCost: number, qtyIn: number, unitCost: number) => number;
  customerBalance: (
    sales: Array<{ total_usd: number; amount_outstanding?: number; status: string }>,
    payments: Array<{ amount_usd: number; status: string }>,
  ) => {
    total_purchases: number;
    total_paid: number;
    outstanding: number;
    credit: number;
  };
  salePaymentState: (sale: { get: (f: string) => unknown }) => {
    total: number;
    paid: number;
    outstanding: number;
    status: "paid" | "partial" | "unpaid" | "void";
  };
  buildTransactionSnapshot: (args: {
    type: string;
    original_amount: number;
    original_currency: "USD" | "SSP";
    exchange_rate: number;
    date?: string;
    user?: string | null;
  }) => {
    type: string;
    original_amount: number;
    original_currency: "USD" | "SSP";
    exchange_rate: number;
    amount_usd: number;
    date: string;
    user: string | null;
  };
};

export const MINOR: number;
export const fromMinor: (n: number) => number;
export const toMinor: (n: number) => number;
export const roundMoney: (n: number) => number;
export const roundHalfUp: (n: number) => number;
export const sspToUsd: (amount: number, rate: number) => number;
export const usdToSsp: (amount: number, rate: number) => number;
export const toUsd: (amount: number, fromCurrency: "USD" | "SSP", rate: number) => number;
export const fromUsd: (amountUsd: number, toCurrency: "USD" | "SSP", rate: number) => number;
export const formatMoney: (n: number) => string;
export const formatMoneyGrouped: (n: number) => string;
export const formatWhole: (n: number) => string;
export const formatCurrency: (amount: number, currency: "USD" | "SSP") => string;
export const lineTotal: (price: number, qty: number) => number;
export const cartTotals: (lines: Array<{ unit_price: number; quantity: number; discount?: number }>) => {
  subtotal: number;
  discount: number;
  total: number;
};
export const paymentTotals: (args: {
  total_usd: number;
  payment_currency: "USD" | "SSP";
  rate: number;
  tendered: number;
}) => {
  total_usd: number;
  payment_currency: "USD" | "SSP";
  rate: number;
  amount_due: number;
  amount_usd: number;
  tendered: number;
  change: number;
};
export const actualPaidAmount: (args: { amount_due: number; tendered?: number; paid_amount?: number | null }) => {
  paid: number;
  tendered: number;
  change: number;
  due: number;
};
export const percentDiscount: (total: number, pct: number) => number;
export const absoluteDiscount: (total: number, amount: number) => number;
export const grossProfit: (revenue: number, cogs: number) => number;
export const netProfit: (gross: number, expenses: number, losses: number) => number;
export const damageCost: (qty: number, unitCost: number) => number;
export const netSalary: (base: number, allowances: number, deductions: number) => number;
export const generateId: (prefix: string, seq: number, dateKey?: string, dated?: boolean) => string;
export const todayKey: (offsetDays?: number) => string;
export const movingAverage: (onHand: number, avgCost: number, qtyIn: number, unitCost: number) => number;
export const customerBalance: (
  sales: Array<{ total_usd: number; amount_outstanding?: number; status: string }>,
  payments: Array<{ amount_usd: number; status: string }>,
) => {
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  credit: number;
};
export const salePaymentState: (sale: { get: (f: string) => unknown }) => {
  total: number;
  paid: number;
  outstanding: number;
  status: "paid" | "partial" | "unpaid" | "void";
};
export const buildTransactionSnapshot: (args: {
  type: string;
  original_amount: number;
  original_currency: "USD" | "SSP";
  exchange_rate: number;
  date?: string;
  user?: string | null;
}) => {
  type: string;
  original_amount: number;
  original_currency: "USD" | "SSP";
  exchange_rate: number;
  amount_usd: number;
  date: string;
  user: string | null;
};
export default engine;
