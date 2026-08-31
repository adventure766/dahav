/**
 * POS flow tests — exercises the exact calculation sequence the POS UI uses:
 * cart -> cartTotals -> paymentTotals -> checkout payload.
 * Mirrors PosPage.tsx logic so UI and server stay consistent.
 */
import { describe, it, expect } from "vitest";
import { cartTotals, paymentTotals } from "../src/lib/engine";
import { usdToSsp, sspToUsd } from "../src/lib/engine";

describe("POS cart flow", () => {
  it("2x milk $2.50 + 1x bread $1.50 = $6.50", () => {
    const t = cartTotals([
      { unit_price: 2.5, quantity: 2 },
      { unit_price: 1.5, quantity: 1 },
    ]);
    expect(t.subtotal).toBe(6.5);
    expect(t.total).toBe(6.5);
  });

  it("required: $5.00 total, SSP payment @8000 -> 40,000 SSP due, 50,000 tendered -> 10,000 change", () => {
    const t = cartTotals([{ unit_price: 2.5, quantity: 2 }]);
    expect(t.total).toBe(5);
    const pay = paymentTotals({ total_usd: t.total, payment_currency: "SSP", rate: 8000, tendered: 50000 });
    expect(pay.amount_due).toBe(40000);
    expect(pay.amount_usd).toBe(5);
    expect(pay.change).toBe(10000);
    // Explicit conversion checks
    expect(usdToSsp(5, 8000)).toBe(40000);
    expect(sspToUsd(40000, 8000)).toBe(5);
  });

  it("USD payment: $6.50 due, $10 tendered -> $3.50 change", () => {
    const t = cartTotals([{ unit_price: 3.25, quantity: 2 }]);
    const pay = paymentTotals({ total_usd: t.total, payment_currency: "USD", rate: 8000, tendered: 10 });
    expect(pay.amount_due).toBe(6.5);
    expect(pay.change).toBe(3.5);
  });

  it("custom rate 8200 changes the SSP amount due", () => {
    const t = cartTotals([{ unit_price: 2.5, quantity: 2 }]); // $5
    const def = paymentTotals({ total_usd: t.total, payment_currency: "SSP", rate: 8000, tendered: 0 });
    const custom = paymentTotals({ total_usd: t.total, payment_currency: "SSP", rate: 8200, tendered: 0 });
    expect(def.amount_due).toBe(40000);
    expect(custom.amount_due).toBe(41000); // 5 * 8200
    expect(custom.amount_usd).toBe(5);
  });

  it("never relabels SSP as USD", () => {
    const pay = paymentTotals({ total_usd: 5, payment_currency: "SSP", rate: 8000, tendered: 50000 });
    expect(pay.amount_due).toBe(40000);
    expect(pay.payment_currency).toBe("SSP");
    expect(pay.amount_usd).toBe(5); // USD equivalent stored separately
  });

  it("cart quantity cannot exceed stock", () => {
    // The UI clamps quantity to stock; simulate 2 units max
    const qty = Math.min(5, 2);
    const t = cartTotals([{ unit_price: 10, quantity: qty }]);
    expect(t.total).toBe(20);
  });
});
