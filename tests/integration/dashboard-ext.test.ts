/**
 * Dashboard extension tests.
 * Covers the new server-side dashboard aggregations:
 * - performance granularity (day/week/month)
 * - previous-period summary (same engine, equal-length preceding window)
 * - recent transactions (from the ledger, per-row currency, capped)
 * - top selling products (aggregated from sale_items, period-scoped)
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

async function get(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: token } : {} });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Deterministic far-future day that parallel files and repeat runs can't contaminate. */
function uniqueDay(offset = 0): string {
  const t = Date.now();
  const year = 2200 + ((t + offset) % 300);
  const month = ((t + offset) % 12) + 1;
  const day = ((t + offset) % 27) + 1;
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00Z`).toISOString().slice(0, 10);
}

beforeAll(async () => {
  const auth = await post("/api/collections/_superusers/auth-with-password", { identity: "admin@dahav.local", password: "admin12345" });
  suToken = auth.data.token;
  const suffix = Date.now();
  const mgr = await post("/api/collections/users/records", {
    email: `dext-mgr-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "DextMgr", role: "manager",
  }, suToken);
  const cas = await post("/api/collections/users/records", {
    email: `dext-cas-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "DextCas", role: "cashier",
  }, suToken);
  const ma = await post("/api/collections/users/auth-with-password", { identity: `dext-mgr-${suffix}@dahav.local`, password: "password123" });
  mgrToken = ma.data.token;
  const ca = await post("/api/collections/users/auth-with-password", { identity: `dext-cas-${suffix}@dahav.local`, password: "password123" });
  cashierToken = ca.data.token;
});

describe("dashboard extensions", () => {
  it("performance respects an explicit day/week/month granularity", async () => {
    const D = uniqueDay(7); // distinct anchor from other tests
    // Seed 3 sales on consecutive days of the same isolated week so day vs week bucketing differs.
    const suffix = Date.now();
    const prod = await post("/api/collections/products/records", {
      name: `DextG-${suffix}`, unit_price: 10, unit_cost: 6, stock: 0, currency: "USD", active: true,
    }, mgrToken);
    await post("/api/dahav/inventory/stock-in", { product_id: prod.data.id, quantity: 30, unit_cost: 6 }, mgrToken);
    for (let i = 1; i <= 3; i++) {
      const d = new Date(`${D}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const day = d.toISOString().slice(0, 10);
      const co = await post("/api/dahav/pos/checkout", {
        items: [{ product_id: prod.data.id, quantity: 1 }],
        payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 10, paid_amount: 10,
        date: `${day}T10:00:00.000Z`,
      }, cashierToken);
      expect(co.status).toBe(200);
    }

    const from = new Date(`${D}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() + 1);
    const to = new Date(`${D}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 3);
    const q = `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;

    const byDay = await get(`/api/dahav/dashboard/performance?${q}&granularity=day`, mgrToken);
    const byWeek = await get(`/api/dahav/dashboard/performance?${q}&granularity=week`, mgrToken);
    const byMonth = await get(`/api/dahav/dashboard/performance?${q}&granularity=month`, mgrToken);

    expect(byDay.status).toBe(200);
    expect(byDay.data.granularity).toBe("day");
    expect(byWeek.data.granularity).toBe("week");
    expect(byMonth.data.granularity).toBe("month");
    expect(byDay.data.rows.length).toBe(3);      // one bucket per sale day
    expect(byWeek.data.rows.length).toBe(1);     // all within one week
    expect(byMonth.data.rows.length).toBe(1);    // all within one month
    // Total revenue identical regardless of granularity
    const sum = (rows: Array<{ revenue: number }>) => Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100;
    expect(sum(byDay.data.rows)).toBe(30);
    expect(sum(byDay.data.rows)).toBe(sum(byWeek.data.rows));
    expect(sum(byDay.data.rows)).toBe(sum(byMonth.data.rows));
  });

  it("previous-period summary uses the same engine and an equal-length preceding window", async () => {
    const D = uniqueDay(21); // distinct anchor from other tests AND previous failed runs
    const suffix = Date.now();
    const prod = await post("/api/collections/products/records", {
      name: `DextP-${suffix}`, unit_price: 50, unit_cost: 30, stock: 0, currency: "USD", active: true,
    }, mgrToken);
    await post("/api/dahav/inventory/stock-in", { product_id: prod.data.id, quantity: 5, unit_cost: 30 }, mgrToken);

    // One sale in the PREVIOUS window (D-20 falls inside D-31..D-11), two in the current (D-5, D+5).
    const from = new Date(`${D}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 10);
    const to = new Date(`${D}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 10);
    const prevSale = new Date(`${D}T00:00:00Z`);
    prevSale.setUTCDate(prevSale.getUTCDate() - 20);
    await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 1 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 50, paid_amount: 50,
      date: `${prevSale.toISOString().slice(0, 10)}T10:00:00.000Z`,
    }, cashierToken);
    for (const off of [-5, 5]) {
      const d = new Date(`${D}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + off);
      await post("/api/dahav/pos/checkout", {
        items: [{ product_id: prod.data.id, quantity: 1 }],
        payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 50, paid_amount: 50,
        date: `${d.toISOString().slice(0, 10)}T10:00:00.000Z`,
      }, cashierToken);
    }

    const q = `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
    const cur = await get(`/api/dahav/dashboard?${q}`, mgrToken);
    const prev = await get(`/api/dahav/dashboard/previous?${q}`, mgrToken);

    expect(cur.status).toBe(200);
    expect(prev.status).toBe(200);
    // Current window holds the 2 sales; previous window holds 1 sale.
    expect(cur.data.sales_count).toBe(2);
    expect(prev.data.sales_count).toBe(1);
    expect(prev.data.revenue).toBe(50);
    // Same engine identity holds inside the previous summary too.
    expect(Math.round(prev.data.gross_profit * 100) / 100).toBe(Math.round((prev.data.revenue - prev.data.cogs) * 100) / 100);
    expect(typeof prev.data.net_profit).toBe("number");
  });

  it("recent transactions come from the ledger with per-row currency and are capped", async () => {
    const txns = await get("/api/dahav/dashboard/transactions?limit=4", mgrToken);
    expect(txns.status).toBe(200);
    expect(Array.isArray(txns.data.rows)).toBe(true);
    expect(txns.data.rows.length).toBeLessThanOrEqual(4);
    for (const r of txns.data.rows) {
      expect(r.transaction_id).toMatch(/^TR-/);
      expect(["USD", "SSP"]).toContain(r.original_currency);
      expect(typeof r.original_amount).toBe("number");
      expect(typeof r.amount_usd).toBe("number");
      expect(typeof r.exchange_rate).toBe("number");
      expect(typeof r.date).toBe("string");
      // Never a "$" on an SSP original amount
      if (r.original_currency === "SSP") {
        expect(String(r.original_amount)).not.toContain("$");
      }
    }
    // Newest first by date
    const dated = txns.data.rows.map((r: { date: string }) => new Date(r.date).getTime());
    for (let i = 1; i < dated.length; i++) {
      expect(dated[i - 1]).toBeGreaterThanOrEqual(dated[i]);
    }
  });

  it("top selling products aggregate sale_items within the period", async () => {
    const D = uniqueDay();
    const suffix = Date.now();
    const prod = await post("/api/collections/products/records", {
      name: `DextT-${suffix}`, unit_price: 10, unit_cost: 4, stock: 0, currency: "USD", active: true,
    }, mgrToken);
    await post("/api/dahav/inventory/stock-in", { product_id: prod.data.id, quantity: 10, unit_cost: 4 }, mgrToken);
    // 3 units sold on D
    const co = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 3 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 30, paid_amount: 30,
      date: `${D}T10:00:00.000Z`,
    }, cashierToken);
    expect(co.status).toBe(200);

    const top = await get(`/api/dahav/dashboard/top-products?from=${D}&to=${D}&limit=5`, mgrToken);
    expect(top.status).toBe(200);
    const row = top.data.rows.find((r: { product_id: string }) => r.product_id === prod.data.id);
    expect(row).toBeTruthy();
    expect(row.units_sold).toBe(3);
    expect(row.revenue_usd).toBe(30);   // 3 x $10
    expect(row.cogs_usd).toBe(12);      // 3 x $4
  });

  it("new endpoints require dashboard.view (403 without auth)", async () => {
    const anon = await get("/api/dahav/dashboard/previous");
    expect(anon.status).toBe(403);
    const anonT = await get("/api/dahav/dashboard/transactions");
    expect(anonT.status).toBe(403);
    const anonTop = await get("/api/dahav/dashboard/top-products");
    expect(anonTop.status).toBe(403);
  });
});
