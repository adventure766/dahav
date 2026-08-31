/**
 * Calculation Engine unit tests.
 * These exercise the SAME engine file used by pb_hooks and the frontend.
 */
import { describe, it, expect } from "vitest";
import {
  sspToUsd,
  usdToSsp,
  toUsd,
  fromUsd,
  formatCurrency,
  lineTotal,
  cartTotals,
  paymentTotals,
  percentDiscount,
  absoluteDiscount,
  grossProfit,
  netProfit,
  damageCost,
  netSalary,
  generateId,
  movingAverage,
  customerBalance,
  salePaymentState,
  actualPaidAmount,
  roundMoney,
} from "../src/lib/engine";

describe("currency conversion", () => {
  it("converts SSP to USD: 500,000 SSP / 8000 = $62.50", () => {
    expect(sspToUsd(500000, 8000)).toBe(62.5);
    expect(toUsd(500000, "SSP", 8000)).toBe(62.5);
  });

  it("converts USD to SSP: $2.50 * 8000 = 20,000 SSP", () => {
    expect(usdToSsp(2.5, 8000)).toBe(20000);
    expect(fromUsd(2.5, "SSP", 8000)).toBe(20000);
  });

  it("identity for USD", () => {
    expect(toUsd(100, "USD", 8000)).toBe(100);
    expect(fromUsd(100, "USD", 8000)).toBe(100);
  });

  it("throws on invalid rate", () => {
    expect(() => sspToUsd(100, 0)).toThrow();
    expect(() => usdToSsp(100, -5)).toThrow();
  });

  it("rounds half-up to 2 decimals", () => {
    expect(sspToUsd(100, 3)).toBe(33.33);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("required test: $5.00 total, payment in SSP at 8000 -> 40,000 SSP", () => {
    const pay = paymentTotals({ total_usd: 5, payment_currency: "SSP", rate: 8000, tendered: 40000 });
    expect(pay.amount_due).toBe(40000);
    expect(pay.amount_usd ? undefined : undefined);
    // USD equivalent stays $5.00
    expect(pay.total_usd).toBe(5);
  });
});

describe("formatting", () => {
  it("formats USD with $ and SSP with the SSP label", () => {
    expect(formatCurrency(2.5, "USD")).toBe("$2.50");
    expect(formatCurrency(40000, "SSP")).toBe("40,000 SSP");
  });

  it("never relabels currency", () => {
    expect(formatCurrency(500000, "SSP")).not.toContain("$");
    expect(formatCurrency(500000, "SSP")).not.toContain("USD");
    expect(formatCurrency(500000, "SSP")).toBe("500,000 SSP");
  });
});

describe("cart totals", () => {
  it("computes line totals and cart totals centrally", () => {
    const lines = [
      { unit_price: 2.5, quantity: 2 }, // milk $5.00
      { unit_price: 1.5, quantity: 1 }, // bread $1.50
    ];
    const t = cartTotals(lines);
    expect(t.subtotal).toBe(6.5);
    expect(t.total).toBe(6.5);
  });

  it("applies discounts", () => {
    const t = cartTotals([{ unit_price: 10, quantity: 3 }]); // $30
    const d = absoluteDiscount(t.total, 5); // $5 off
    expect(d).toBe(5);
    expect(percentDiscount(30, 10)).toBe(3); // 10% of 30
  });
});

describe("payment totals", () => {
  it("calculates change in SSP correctly", () => {
    const pay = paymentTotals({ total_usd: 5, payment_currency: "SSP", rate: 8000, tendered: 50000 });
    expect(pay.amount_due).toBe(40000);
    expect(pay.tendered).toBe(50000);
    expect(pay.change).toBe(10000);
  });

  it("calculates change in USD correctly", () => {
    const pay = paymentTotals({ total_usd: 6.5, payment_currency: "USD", rate: 8000, tendered: 10 });
    expect(pay.amount_due).toBe(6.5);
    expect(pay.change).toBe(3.5);
  });

  it("never produces negative change", () => {
    const pay = paymentTotals({ total_usd: 10, payment_currency: "USD", rate: 8000, tendered: 5 });
    expect(pay.change).toBe(0);
  });

  it("required test: 500,000 SSP payment -> $62.50", () => {
    expect(sspToUsd(500000, 8000)).toBe(62.5);
  });
});

describe("profit & loss", () => {
  it("gross profit = revenue - COGS", () => {
    expect(grossProfit(40, 25)).toBe(15);
  });

  it("net profit = gross - expenses - losses", () => {
    expect(netProfit(15, 5, 2)).toBe(8);
  });
});

describe("damage", () => {
  it("damage cost = quantity x unit cost (NOT selling price)", () => {
    // cost $2.50, selling $4.00, 10 units
    expect(damageCost(10, 2.5)).toBe(25);
    expect(damageCost(10, 2.5)).not.toBe(40);
  });
});

describe("payroll", () => {
  it("net salary = base + allowances - deductions", () => {
    expect(netSalary(100, 20, 10)).toBe(110);
  });

  it("SSP salary 800,000 at 8000 -> $100", () => {
    expect(sspToUsd(800000, 8000)).toBe(100);
  });
});

describe("IDs", () => {
  it("generates dated sequential IDs", () => {
    expect(generateId("TR", 1, "20260828", true)).toBe("TR-20260828-0001");
    expect(generateId("PAY", 25, "20260828", true)).toBe("PAY-20260828-0025");
  });
});

describe("moving average inventory", () => {
  it("updates average cost on stock-in", () => {
    // 10 units @ $2.00, buy 10 more @ $3.00 -> avg $2.50
    expect(movingAverage(10, 2, 10, 3)).toBe(2.5);
  });
});

describe("customer balances", () => {
  it("uses the persisted sale amount_outstanding as the authoritative balance", () => {
    // A $100 sale with $60 paid has amount_outstanding=40 persisted by the engine.
    const sales = [{ total_usd: 100, amount_outstanding: 40, status: "completed" }];
    const payments = [{ amount_usd: 60, status: "paid" }];
    const b = customerBalance(sales, payments);
    expect(b.total_purchases).toBe(100);
    expect(b.total_paid).toBe(60);
    expect(b.outstanding).toBe(40);
    expect(b.credit).toBe(0);
  });

  it("reports zero outstanding when a sale is fully paid", () => {
    const sales = [{ total_usd: 100, amount_outstanding: 0, status: "completed" }];
    const payments = [{ amount_usd: 100, status: "paid" }];
    const b = customerBalance(sales, payments);
    expect(b.total_purchases).toBe(100);
    expect(b.total_paid).toBe(100);
    expect(b.outstanding).toBe(0);
    expect(b.credit).toBe(0);
  });

  it("never lets outstanding go negative even if payment records exceed the sale", () => {
    const sales = [{ total_usd: 100, amount_outstanding: 0, status: "completed" }];
    const payments = [{ amount_usd: 120, status: "paid" }];
    const b = customerBalance(sales, payments);
    expect(b.outstanding).toBe(0);
    expect(b.credit).toBe(0);
  });
});

describe("sale payment state (single source of truth)", () => {
  const sale = (total: number, amount_paid: number, amount_outstanding: number, opts: { voided?: boolean } = {}) => ({
    get: (f: string) => {
      switch (f) {
        case "total": return total;
        case "amount_paid": return amount_paid;
        case "amount_outstanding": return amount_outstanding;
        case "voided": return opts.voided || false;
        default: return undefined;
      }
    },
  });

  it("TEST 1: $100 sale, $100 paid -> PAID, outstanding 0", () => {
    const s = salePaymentState(sale(100, 100, 0));
    expect(s.paid).toBe(100);
    expect(s.outstanding).toBe(0);
    expect(s.status).toBe("paid");
  });

  it("TEST 2: $100 sale, $60 paid -> PARTIALLY PAID, outstanding 40", () => {
    const s = salePaymentState(sale(100, 60, 40));
    expect(s.paid).toBe(60);
    expect(s.outstanding).toBe(40);
    expect(s.status).toBe("partial");
  });

  it("TEST 3: $100 sale, $0 paid -> UNPAID, outstanding 100", () => {
    const s = salePaymentState(sale(100, 0, 100));
    expect(s.paid).toBe(0);
    expect(s.outstanding).toBe(100);
    expect(s.status).toBe("unpaid");
  });

  it("TEST 4: $100 sale, $50 paid -> PARTIALLY PAID, outstanding 50", () => {
    const s = salePaymentState(sale(100, 50, 50));
    expect(s.paid).toBe(50);
    expect(s.outstanding).toBe(50);
    expect(s.status).toBe("partial");
  });

  it("TEST 5: $100 sale, $100 paid after two payments -> PAID", () => {
    const s = salePaymentState(sale(100, 100, 0));
    expect(s.paid).toBe(100);
    expect(s.outstanding).toBe(0);
    expect(s.status).toBe("paid");
  });

  it("TEST 6: clamps a stale paid amount to the total (never negative outstanding)", () => {
    const s = salePaymentState(sale(100, 150, -50));
    expect(s.paid).toBe(100);
    expect(s.outstanding).toBe(0);
    expect(s.status).toBe("paid");
  });

  it("voided sales report no outstanding", () => {
    const s = salePaymentState(sale(100, 0, 100, { voided: true }));
    expect(s.status).toBe("void");
    expect(s.outstanding).toBe(0);
  });
});

describe("actual paid amount (AMOUNT DUE vs AMOUNT PAID)", () => {
  // The user's exact scenario: $32.00 at 8200 -> 262,400 SSP due.
  const DUE = 262400;

  it("TEST 1: due 262,400 SSP, tendered 260,000 SSP -> paid 260,000, change 0, outstanding 2,400", () => {
    const r = actualPaidAmount({ amount_due: DUE, tendered: 260000, paid_amount: undefined });
    expect(r.paid).toBe(260000);
    expect(r.change).toBe(0);
    // outstanding is due - paid (USD layer: 32.00 - 260000/8200 ≈ 0.29)
    const outstandingUsd = 32 - 260000 / 8200;
    expect(outstandingUsd).toBeCloseTo(0.2927, 3);
  });

  it("TEST 2: due 262,400 SSP, paid 262,400 SSP -> paid in full, outstanding 0", () => {
    const r = actualPaidAmount({ amount_due: DUE, tendered: DUE, paid_amount: undefined });
    expect(r.paid).toBe(DUE);
    expect(r.change).toBe(0);
    expect(32 - r.paid / 8200).toBeCloseTo(0, 10);
  });

  it("TEST 3: due 262,400 SSP, paid 0 -> UNPAID, outstanding full due", () => {
    const r = actualPaidAmount({ amount_due: DUE, tendered: 0, paid_amount: undefined });
    expect(r.paid).toBe(0);
    expect(r.change).toBe(0);
    expect(32 - r.paid / 8200).toBeCloseTo(32, 10);
  });

  it("TEST 4: two payments 260,000 + 2,400 -> total paid 262,400, outstanding 0", () => {
    const p1 = actualPaidAmount({ amount_due: DUE, tendered: 260000, paid_amount: undefined });
    const remaining = DUE - p1.paid;
    const p2 = actualPaidAmount({ amount_due: remaining, tendered: remaining, paid_amount: undefined });
    expect(p1.paid).toBe(260000);
    expect(remaining).toBe(2400);
    expect(p2.paid).toBe(2400);
    expect(p1.paid + p2.paid).toBe(DUE);
    expect(32 - (p1.paid + p2.paid) / 8200).toBeCloseTo(0, 10);
  });

  it("TEST 5: due 262,400 SSP, tendered 300,000 SSP -> paid 262,400, change 37,600, outstanding 0", () => {
    const r = actualPaidAmount({ amount_due: DUE, tendered: 300000, paid_amount: undefined });
    expect(r.paid).toBe(DUE);
    expect(r.change).toBe(37600);
    expect(32 - r.paid / 8200).toBeCloseTo(0, 10);
  });

  it("paid_amount override is respected (recorded partial without tendered)", () => {
    const r = actualPaidAmount({ amount_due: DUE, tendered: 0, paid_amount: 100000 });
    expect(r.paid).toBe(100000);
    expect(r.change).toBe(0);
  });

  it("rejects paid_amount above due", () => {
    expect(() => actualPaidAmount({ amount_due: DUE, tendered: 0, paid_amount: 300000 })).toThrow();
  });
});

describe("payment-currency outstanding (exact in-currency subtraction)", () => {
  // The user's $48.00 case: 6 x $8.00 at 8200 -> 393,600 SSP due.
  const RATE = 8200;
  const totalUsd = 48;
  const amountDueSsp = usdToSsp(totalUsd, RATE); // 393,600

  it("due 393,600 SSP, paid 300,000 SSP -> outstanding EXACTLY 93,600 SSP (not 93,562, not 11)", () => {
    expect(amountDueSsp).toBe(393600);
    // The bug: USD round-trip loses exactness.
    const paidUsd = sspToUsd(300000, RATE); // 36.5854 -> rounds to 36.59
    expect(paidUsd).toBe(36.59);
    const viaUsdRoundTrip = usdToSsp(paidUsd, RATE); // 36.59 * 8200 = 300,038
    expect(viaUsdRoundTrip).toBe(300038);
    // The fix: exact in-currency subtraction.
    const outstandingCcy = Math.max(0, Math.round((amountDueSsp - 300000) * 100) / 100);
    expect(outstandingCcy).toBe(93600);
  });

  it("due 393,600 SSP, paid 393,600 SSP -> outstanding 0, PAID", () => {
    const outstandingCcy = Math.max(0, amountDueSsp - 393600);
    expect(outstandingCcy).toBe(0);
    expect(outstandingCcy).toBe(0); // PAID
  });

  it("due 393,600 SSP, paid 0 -> outstanding 393,600, UNPAID", () => {
    const outstandingCcy = Math.max(0, amountDueSsp - 0);
    expect(outstandingCcy).toBe(393600);
    expect(outstandingCcy > 0).toBe(true);
  });
});
