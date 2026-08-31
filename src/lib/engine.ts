/**
 * Typed wrapper around the shared Calculation Engine.
 * The engine is authored as CJS (pb_hooks/engine/index.cjs) for PocketBase's
 * goja runtime and Vitest, and an identical ESM copy (index.mjs) is imported
 * by the frontend. A sync test (tests/engine-sync.test.ts) verifies the two
 * never drift — keeping one source of truth.
 */
import engine from "../../pb_hooks/engine/index.mjs";

export type Currency = "USD" | "SSP";

export interface MoneyAmount {
  original_amount: number;
  original_currency: Currency;
  exchange_rate: number;
  amount_usd: number;
}

export interface LineInput {
  unit_price: number;
  quantity: number;
  discount?: number;
}

export interface CartTotalsResult {
  subtotal: number;
  discount: number;
  total: number;
}

export interface PaymentTotalsResult {
  total_usd: number;
  payment_currency: Currency;
  rate: number;
  amount_due: number;
  amount_usd: number;
  tendered: number;
  change: number;
}

export interface CustomerBalanceResult {
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  credit: number;
}

export const MINOR: number = engine.MINOR;
export const fromMinor: (n: number) => number = engine.fromMinor;
export const toMinor: (n: number) => number = engine.toMinor;
export const roundMoney: (n: number) => number = engine.roundMoney;
export const roundHalfUp: (n: number) => number = engine.roundHalfUp;
export const sspToUsd: (amountSsp: number, rate: number) => number = engine.sspToUsd;
export const usdToSsp: (amountUsd: number, rate: number) => number = engine.usdToSsp;
export const toUsd: (amount: number, fromCurrency: Currency, rate: number) => number = engine.toUsd;
export const fromUsd: (amountUsd: number, toCurrency: Currency, rate: number) => number = engine.fromUsd;
export const formatMoney: (n: number) => string = engine.formatMoney;
export const formatMoneyGrouped: (n: number) => string = engine.formatMoneyGrouped;
export const formatWhole: (n: number) => string = engine.formatWhole;
export const formatCurrency: (amount: number, currency: Currency) => string = engine.formatCurrency;
export const lineTotal: (unitPrice: number, quantity: number) => number = engine.lineTotal;
export const cartTotals: (lines: LineInput[]) => CartTotalsResult = engine.cartTotals;
export const paymentTotals: (args: {
  total_usd: number;
  payment_currency: Currency;
  rate: number;
  tendered: number;
}) => PaymentTotalsResult = engine.paymentTotals;
export const actualPaidAmount: (args: { amount_due: number; tendered?: number; paid_amount?: number | null }) => {
  paid: number;
  tendered: number;
  change: number;
  due: number;
} = engine.actualPaidAmount;
export const percentDiscount: (total: number, pct: number) => number = engine.percentDiscount;
export const absoluteDiscount: (total: number, amount: number) => number = engine.absoluteDiscount;
export const grossProfit: (revenue: number, cogs: number) => number = engine.grossProfit;
export const netProfit: (gross: number, expenses: number, losses: number) => number = engine.netProfit;
export const damageCost: (quantity: number, unitCost: number) => number = engine.damageCost;
export const netSalary: (base: number, allowances: number, deductions: number) => number = engine.netSalary;
export const generateId: (prefix: string, seq: number, dateKey?: string, dated?: boolean) => string = engine.generateId;
export const todayKey: (offsetDays?: number) => string = engine.todayKey;
export const movingAverage: (qtyOnHand: number, avgCost: number, qtyIn: number, unitCost: number) => number = engine.movingAverage;
export const customerBalance: (
  sales: Array<{ total_usd: number; amount_outstanding?: number; status: string }>,
  payments: Array<{ amount_usd: number; status: string }>,
) => CustomerBalanceResult = engine.customerBalance;
export const salePaymentState: (sale: { get: (f: string) => unknown }) => { total: number; paid: number; outstanding: number; status: "paid" | "partial" | "unpaid" | "void" } = engine.salePaymentState;
export const buildTransactionSnapshot: (args: {
  type: string;
  original_amount: number;
  original_currency: Currency;
  exchange_rate: number;
  date?: string;
  user?: string | null;
}) => MoneyAmount & { type: string; date: string; user: string | null } = engine.buildTransactionSnapshot;

export default engine;
