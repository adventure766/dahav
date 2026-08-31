/**
 * Receipt traceability integration test:
 * Sale -> Transaction ID -> Payment -> Receipt must all link to the same
 * transaction, and the receipt payload must carry transaction_id.
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.DAHAV_TEST_BASE || "http://127.0.0.1:8092";

let suToken: string;
let mgrToken: string;
let cashierToken: string;

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

beforeAll(async () => {
  const auth = await post("/api/collections/_superusers/auth-with-password", { identity: "admin@dahav.local", password: "admin12345" });
  suToken = auth.data.token;
  const suffix = Date.now();
  const mgr = await post("/api/collections/users/records", {
    email: `rt-mgr-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "RTMgr", role: "manager",
  }, suToken);
  const cas = await post("/api/collections/users/records", {
    email: `rt-cas-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "RTCas", role: "cashier",
  }, suToken);
  const ma = await post("/api/collections/users/auth-with-password", { identity: `rt-mgr-${suffix}@dahav.local`, password: "password123" });
  mgrToken = ma.data.token;
  const ca = await post("/api/collections/users/auth-with-password", { identity: `rt-cas-${suffix}@dahav.local`, password: "password123" });
  cashierToken = ca.data.token;
});

describe("receipt traceability", () => {
  it("sale -> transaction -> payment -> receipt all carry the same transaction lineage", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `RT-${Date.now()}`, unit_price: 2.5, unit_cost: 1.5, stock: 20, currency: "USD", active: true,
    }, mgrToken);
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 2 }],
      payment_method: "cash", payment_currency: "SSP", exchange_rate: 8000, tendered: 50000,
    }, cashierToken);
    expect(checkout.status).toBe(200);
    const r = checkout.data;

    // Sale -> transaction
    expect(r.sale.transaction).toBeTruthy();
    const txn = await (await fetch(`${BASE}/api/collections/transactions/records/${r.sale.transaction}`)).json();
    expect(txn.transaction_id).toBe(r.transaction.transaction_id);

    // Payment -> same sale + its own transaction
    expect(r.payment.sale).toBe(r.sale.id);
    expect(r.payment.transaction).toBeTruthy();
    expect(r.payment.transaction).not.toBe(r.sale.transaction); // payment has its own ledger entry

    // Receipt -> links
    const rec = await (await fetch(`${BASE}/api/collections/receipts/records/${r.receipt.id}`)).json();
    expect(rec.receipt_id).toBe(r.receipt.receipt_id);
    expect(rec.transaction).toBe(r.sale.transaction);
    expect(rec.payment).toBe(r.payment.id);
    expect(rec.sale).toBe(r.sale.id);

    // Receipt payload has transaction_id for search/trace
    expect(rec.data.transaction_id).toBe(r.transaction.transaction_id);
    expect(rec.data.sale_id).toBe(r.sale.sale_id);
    expect(rec.data.receipt_id).toBe(r.receipt.receipt_id);
    expect(rec.data.payment_currency).toBe("SSP");
    expect(rec.data.amount_due).toBe(40000);
    expect(rec.data.amount_usd).toBe(5);
    expect(rec.data.change).toBe(10000);
  });
});
