/**
 * DAHAV Calculation Engine
 * =========================
 * The SINGLE authoritative source for every financial calculation in the system.
 *
 * - Plain CommonJS so the SAME file is executed by:
 *     1. PocketBase pb_hooks (server-side, authoritative, persisted values)
 *     2. The React frontend (via Vite alias) for live UX preview
 *     3. Vitest (unit tests)
 * - Money is handled in integer minor units ("cents") to avoid float drift.
 * - Currency rule: the canonical exchange rate is "1 USD = X SSP".
 *     SSP -> USD : amount / X
 *     USD -> SSP : amount * X
 * - Every persisted monetary value stores: original_amount, original_currency,
 *   exchange_rate, amount_usd. No silent currency conversion or relabeling.
 */

const MINOR = 100; // 2 decimal places

/* ------------------------------------------------------------------ *
 * Money / rounding primitives
 * ------------------------------------------------------------------ */

function roundHalfUp(n) {
  return Math.round((n + Number.EPSILON) * MINOR) / MINOR;
}

function roundToMinor(n) {
  return Math.round((n + Number.EPSILON) * MINOR) / MINOR;
}

/** Convert a minor-unit integer (e.g. 250) to a float (2.50). */
function fromMinor(minor) {
  if (minor == null || Number.isNaN(Number(minor))) return 0;
  return Number(minor) / MINOR;
}

/** Convert a float to a minor-unit integer with half-up rounding. */
function toMinor(n) {
  const v = Number(n);
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * MINOR);
}

/** Round a monetary float to 2 decimals, half-up. */
function roundMoney(n) {
  return roundToMinor(Number(n));
}

/* ------------------------------------------------------------------ *
 * Currency conversion
 * ------------------------------------------------------------------ */

/** SSP -> USD : amount / rate   (1 USD = rate SSP) */
function sspToUsd(amountSsp, rate) {
  const a = Number(amountSsp) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) throw new Error("Invalid exchange rate: must be greater than zero.");
  return roundMoney(a / r);
}

/** USD -> SSP : amount * rate   (1 USD = rate SSP) */
function usdToSsp(amountUsd, rate) {
  const a = Number(amountUsd) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) throw new Error("Invalid exchange rate: must be greater than zero.");
  return roundMoney(a * r);
}

/**
 * Convert an amount expressed in `fromCurrency` to its USD equivalent.
 * `fromCurrency` is one of "USD" | "SSP". For USD the result is identity.
 */
function toUsd(amount, fromCurrency, rate) {
  const cur = String(fromCurrency || "").toUpperCase();
  if (cur === "USD") return roundMoney(Number(amount) || 0);
  if (cur === "SSP") return sspToUsd(amount, rate);
  throw new Error(`Unsupported currency: ${fromCurrency}`);
}

/**
 * Convert a USD amount into `toCurrency` (USD or SSP).
 */
function fromUsd(amountUsd, toCurrency, rate) {
  const cur = String(toCurrency || "").toUpperCase();
  if (cur === "USD") return roundMoney(Number(amountUsd) || 0);
  if (cur === "SSP") return usdToSsp(amountUsd, rate);
  throw new Error(`Unsupported currency: ${toCurrency}`);
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** "2.5" -> "2.50" */
function formatMoney(n) {
  return (roundMoney(Number(n) || 0)).toFixed(2);
}

/** "2.5" -> "2.50" with thousands separators */
function formatMoneyGrouped(n) {
  return Number(roundMoney(Number(n) || 0)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format an integer (SSP amounts are often large whole numbers).
 * "40000" -> "40,000"
 */
function formatWhole(n) {
  return Number(Math.round(Number(n) || 0)).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

/**
 * Display a monetary value with the CORRECT label.
 * USD -> "$2.50"   SSP -> "20,000 SSP"
 * Never attaches the wrong symbol to a currency.
 */
function formatCurrency(amount, currency) {
  const cur = String(currency || "").toUpperCase();
  if (cur === "USD") return `$${formatMoneyGrouped(amount)}`;
  if (cur === "SSP") return `${formatWhole(amount)} SSP`;
  return `${formatMoneyGrouped(amount)} ${cur}`;
}

/* ------------------------------------------------------------------ *
 * Cart / line-item math
 * ------------------------------------------------------------------ */

/**
 * Compute a sale line total.
 * Line Total = Unit Price × Quantity
 * Prices are in the product's base currency (USD by default).
 */
function lineTotal(unitPrice, quantity) {
  const p = Number(unitPrice) || 0;
  const q = Number(quantity) || 0;
  return roundMoney(p * q);
}

/**
 * Compute cart totals.
 * @param {Array<{unit_price:number, quantity:number, discount?:number}>} lines
 * @returns {{subtotal:number, discount:number, total:number}}
 */
function cartTotals(lines) {
  let subtotal = 0;
  for (const l of lines || []) {
    subtotal += lineTotal(l.unit_price, l.quantity);
  }
  subtotal = roundMoney(subtotal);
  let discount = 0;
  for (const l of lines || []) {
    discount += Number(l.discount) || 0;
  }
  discount = roundMoney(discount);
  let total = roundMoney(subtotal - discount);
  if (total < 0) total = 0;
  return { subtotal, discount, total };
}

/**
 * Given a cart total (in USD, the default base currency) and a payment
 * currency + exchange rate, produce the payment-side amounts.
 *
 * total_usd          : cart total in USD
 * payment_currency   : "USD" | "SSP"
 * rate               : SSP per 1 USD
 * tendered           : amount the customer handed over, in payment_currency
 *
 * Returns:
 * {
 *   total_usd,                // $5.00
 *   payment_currency,         // "SSP"
 *   rate,                     // 8000
 *   amount_due,               // 40,000 (in payment currency)
 *   tendered,                 // as given
 *   change,                   // tendered - amount_due (in payment currency)
 * }
 */
function paymentTotals({ total_usd, payment_currency, rate, tendered }) {
  const cur = String(payment_currency || "").toUpperCase();
  let amount_due;
  if (cur === "USD") {
    amount_due = roundMoney(Number(total_usd) || 0);
  } else if (cur === "SSP") {
    amount_due = usdToSsp(total_usd, rate);
  } else {
    throw new Error(`Unsupported payment currency: ${payment_currency}`);
  }
  const tend = Number(tendered) || 0;
  let change = roundMoney(tend - amount_due);
  if (change < 0) change = 0;
  return {
    total_usd: roundMoney(Number(total_usd) || 0),
    payment_currency: cur,
    rate: Number(rate) || 0,
    amount_due,
    amount_usd: cur === "USD" ? roundMoney(Number(total_usd) || 0) : sspToUsd(amount_due, rate),
    tendered: roundMoney(tend),
    change,
  };
}

/**
 * THE authoritative "how much was actually paid" derivation.
 *
 * AMOUNT DUE is what the customer needed to pay. AMOUNT PAID is what the
 * system actually received and applied. They are NOT the same thing.
 *
 * Rules:
 *  - paid_amount explicitly provided -> that is the actual payment
 *    (a recorded partial/credit payment, no tendered cash).
 *  - tendered >= amount_due          -> paid = amount_due, change = tendered - due.
 *  - tendered < amount_due           -> paid = tendered, change = 0,
 *    outstanding = due - paid. NEVER treat amount_due as paid just because
 *    it was required.
 *  - no tendered and no paid_amount  -> paid = 0 (unpaid).
 *
 * @returns {{ paid:number, tendered:number, change:number, due:number }}
 */
function actualPaidAmount({ amount_due, tendered, paid_amount }) {
  const due = roundMoney(Number(amount_due) || 0);
  const tend = roundMoney(Number(tendered) || 0);
  if (paid_amount !== undefined && paid_amount !== null) {
    const p = roundMoney(Number(paid_amount) || 0);
    if (p > due) throw new Error("paid_amount exceeds amount due");
    return { paid: p, tendered: tend > 0 ? tend : p, change: 0, due };
  }
  if (tend > 0) {
    const paid = Math.min(tend, due);
    return {
      paid,
      tendered: tend,
      change: tend >= due ? roundMoney(tend - due) : 0,
      due,
    };
  }
  return { paid: 0, tendered: 0, change: 0, due };
}

/* ------------------------------------------------------------------ *
 * Discount helpers
 * ------------------------------------------------------------------ */

/** Percent discount: total * (pct/100), rounded half-up. */
function percentDiscount(total, pct) {
  const p = Number(pct) || 0;
  return roundMoney((Number(total) || 0) * p / 100);
}

/** Absolute discount, clamped to [0, total]. */
function absoluteDiscount(total, amount) {
  const a = Number(amount) || 0;
  const t = Number(total) || 0;
  return roundMoney(Math.min(Math.max(a, 0), t));
}

/* ------------------------------------------------------------------ *
 * Profit & loss
 * ------------------------------------------------------------------ */

/**
 * Gross profit = Revenue - COGS.
 * @param {number} revenue_usd
 * @param {number} cogs_usd
 */
function grossProfit(revenue_usd, cogs_usd) {
  return roundMoney((Number(revenue_usd) || 0) - (Number(cogs_usd) || 0));
}

/**
 * Net profit = Gross profit - operating expenses - other losses.
 * All in USD.
 */
function netProfit(gross_profit_usd, operating_expenses_usd, other_losses_usd) {
  return roundMoney(
    (Number(gross_profit_usd) || 0)
    - (Number(operating_expenses_usd) || 0)
    - (Number(other_losses_usd) || 0),
  );
}

/* ------------------------------------------------------------------ *
 * Damage
 * ------------------------------------------------------------------ */

/**
 * Damage cost = damaged quantity × unit cost (the inventory cost basis).
 * NEVER the retail selling price, unless an explicit accounting option says otherwise.
 */
function damageCost(quantity, unitCost) {
  return lineTotal(unitCost, quantity);
}

/* ------------------------------------------------------------------ *
 * Payroll
 * ------------------------------------------------------------------ */

/**
 * Net salary = base + allowances - deductions.
 */
function netSalary(base, allowances, deductions) {
  return roundMoney(
    (Number(base) || 0)
    + (Number(allowances) || 0)
    - (Number(deductions) || 0),
  );
}

/* ------------------------------------------------------------------ *
 * ID generation
 * ------------------------------------------------------------------ */

/**
 * Generate a sequential transaction-style ID.
 * @param {string} prefix  e.g. "TR", "PAY", "INV", "REC", "EXP", "PRL", "DMG", "MOV"
 * @param {number} seq     the next sequence number
 * @param {string} dateKey YYYYMMDD (defaults to today, UTC)
 * @param {boolean} dated  TR-20260828-0001 style when true, else TR-0001
 */
function generateId(prefix, seq, dateKey, dated = true) {
  const p = String(prefix || "TR").toUpperCase();
  const n = String(Number(seq) || 0).padStart(4, "0");
  if (dated) {
    const d = String(dateKey || new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    return `${p}-${d}-${n}`;
  }
  return `${p}-${n}`;
}

/** Today's YYYYMMDD key. */
function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(offsetDays) || 0));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/* ------------------------------------------------------------------ *
 * Moving-average inventory
 * ------------------------------------------------------------------ */

/**
 * Update moving-average unit cost on stock-in.
 * new_cost = (qty_on_hand * avg_cost + qty_in * unit_cost) / (qty_on_hand + qty_in)
 */
function movingAverage(qtyOnHand, avgCost, qtyIn, unitCost) {
  const qh = Number(qtyOnHand) || 0;
  const ac = Number(avgCost) || 0;
  const qi = Number(qtyIn) || 0;
  const uc = Number(unitCost) || 0;
  const totalQty = qh + qi;
  if (totalQty <= 0) return roundMoney(0);
  return roundMoney((qh * ac + qi * uc) / totalQty);
}

/* ------------------------------------------------------------------ *
 * Customer balances (derived from authoritative records)
 * ------------------------------------------------------------------ */

/**
 * The SINGLE authoritative payment state for a sale, derived from the
 * persisted sale balance (which the Calculation Engine writes at checkout
 * and on every payment). This is what every consumer — dashboard, reports,
 * receipts, customer pages — reads so they can never drift apart.
 *
 * @param {object} sale - a `sales` record
 * @returns {{ total:number, paid:number, outstanding:number, status:"paid"|"partial"|"unpaid"|"void" }}
 */
function salePaymentState(sale) {
  if (!sale) return { total: 0, paid: 0, outstanding: 0, status: "unpaid" };
  const total = roundMoney(Number(sale.get("total")) || 0);
  const paid = roundMoney(Math.min(Math.max(Number(sale.get("amount_paid")) || 0, 0), total));
  const outstanding = roundMoney(total - paid);
  if (sale.get("voided")) return { total, paid, outstanding: 0, status: "void" };
  if (outstanding <= 0) return { total, paid, outstanding: 0, status: "paid" };
  if (paid <= 0) return { total, paid, outstanding: total, status: "unpaid" };
  return { total, paid, outstanding, status: "partial" };
}

/**
 * Derive a customer's balance position from a list of sale/payment records.
 * Outstanding is taken from the persisted `amount_outstanding` on each sale
 * (the engine's authoritative value), never re-derived from raw totals, so a
 * customer balance can never disagree with the Sales report.
 * @param {Array<{total_usd:number, amount_outstanding?:number, status:string}>} sales
 * @param {Array<{amount_usd:number, status:string}>} payments
 * @returns {{total_purchases:number, total_paid:number, outstanding:number, credit:number}}
 */
function customerBalance(sales, payments) {
  let total_purchases = 0;
  let total_outstanding = 0;
  for (const s of sales || []) {
    if (s.status === "void" || s.status === "cancelled") continue;
    total_purchases += Number(s.total_usd) || 0;
    total_outstanding += Number(s.amount_outstanding) || 0;
  }
  // Total paid across all non-void payments (independent cross-check).
  let total_paid = 0;
  for (const p of payments || []) {
    if (p.status === "void" || p.status === "refunded") continue;
    total_paid += Number(p.amount_usd) || 0;
  }
  total_purchases = roundMoney(total_purchases);
  total_paid = roundMoney(total_paid);
  // The authoritative outstanding comes from the sale balances. When the
  // payment sum disagrees (e.g. legacy data), the sale balance wins because
  // it is what every report consumes.
  const outstanding = roundMoney(Math.max(total_outstanding, 0));
  const paidFromSales = roundMoney(total_purchases - outstanding);
  const paid = roundMoney(Math.max(paidFromSales, total_paid));
  return {
    total_purchases,
    total_paid: paid,
    outstanding,
    credit: outstanding < 0 ? roundMoney(-outstanding) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Transaction snapshots / receipts
 * ------------------------------------------------------------------ */

/**
 * Build the authoritative persisted calculation snapshot for a transaction.
 * This is what gets written to the DB and read by every report/dashboard.
 */
function buildTransactionSnapshot({
  type,
  original_amount,
  original_currency,
  exchange_rate,
  date,
  user,
}) {
  const cur = String(original_currency || "").toUpperCase();
  const amount = roundMoney(Number(original_amount) || 0);
  const rate = Number(exchange_rate) || 0;
  const amount_usd = cur === "USD" ? amount : sspToUsd(amount, rate);
  return {
    type,
    original_amount: amount,
    original_currency: cur,
    exchange_rate: rate,
    amount_usd,
    date: date || new Date().toISOString(),
    user: user || null,
  };
}

module.exports = {
  MINOR,
  fromMinor,
  toMinor,
  roundMoney,
  roundHalfUp,
  sspToUsd,
  usdToSsp,
  toUsd,
  fromUsd,
  formatMoney,
  formatMoneyGrouped,
  formatWhole,
  formatCurrency,
  lineTotal,
  cartTotals,
  paymentTotals,
  actualPaidAmount,
  percentDiscount,
  absoluteDiscount,
  grossProfit,
  netProfit,
  damageCost,
  netSalary,
  generateId,
  todayKey,
  movingAverage,
  customerBalance,
  salePaymentState,
  buildTransactionSnapshot,
};
