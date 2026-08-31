declare module "../../pb_hooks/engine/index.cjs" {
  export interface MoneyAmount {
    original_amount: number;
    original_currency: "USD" | "SSP";
    exchange_rate: number;
    amount_usd: number;
  }
  const engine: {
    MINOR: number;
    roundMoney: (n: number) => number;
    roundHalfUp: (n: number) => number;
    sspToUsd: (amount: number, rate: number) => number;
    usdToSsp: (amount: number, rate: number) => number;
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
    generateId: (prefix: string, seq: number, dateKey?: string, dated?: boolean) => string;
    todayKey: (offsetDays?: number) => string;
    movingAverage: (onHand: number, avgCost: number, qtyIn: number, unitCost: number) => number;
    netSalary: (base: number, allowances: number, deductions: number) => number;
    grossProfit: (revenue: number, cogs: number) => number;
    netProfit: (gross: number, expenses: number, losses: number) => number;
    damageCost: (qty: number, unitCost: number) => number;
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
    toUsd: (amount: number, fromCurrency: "USD" | "SSP", rate: number) => number;
    fromUsd: (amountUsd: number, toCurrency: "USD" | "SSP", rate: number) => number;
    percentDiscount: (total: number, pct: number) => number;
    absoluteDiscount: (total: number, amount: number) => number;
    buildTransactionSnapshot: (args: {
      type: string;
      original_amount: number;
      original_currency: "USD" | "SSP";
      exchange_rate: number;
      date?: string;
      user?: string | null;
    }) => MoneyAmount & { type: string; date: string; user: string | null };
  };
  export default engine;
}
