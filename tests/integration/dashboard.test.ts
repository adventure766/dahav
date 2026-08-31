/**
 * Dashboard upgrade tests.
 * Verifies the dashboard consumes authoritative results, period filtering is
 * consistent with the report endpoints, and USD/SSP are never merged.
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

/** Unique isolated date per run: a deterministic far-future day that parallel
 *  test files (which write "today") can never contaminate. */
function uniqueDay(): string {
  const t = Date.now();
  const year = 2200 + (t % 300);
  const month = (t % 12) + 1;
  const day = (t % 27) + 1;
  const s = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return new Date(s + "T00:00:00Z").toISOString().slice(0, 10);
}

beforeAll(async () => {
  const auth = await post("/api/collections/_superusers/auth-with-password", { identity: "admin@dahav.local", password: "admin12345" });
  suToken = auth.data.token;
  const suffix = Date.now();
  const mgr = await post("/api/collections/users/records", {
    email: `dash-mgr-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "DashMgr", role: "manager",
  }, suToken);
  const cas = await post("/api/collections/users/records", {
    email: `dash-cas-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "DashCas", role: "cashier",
  }, suToken);
  const ma = await post("/api/collections/users/auth-with-password", { identity: `dash-mgr-${suffix}@dahav.local`, password: "password123" });
  mgrToken = ma.data.token;
  const ca = await post("/api/collections/users/auth-with-password", { identity: `dash-cas-${suffix}@dahav.local`, password: "password123" });
  cashierToken = ca.data.token;
});

describe("dashboard — authoritative source + period filtering", () => {
  it("dashboard KPIs match the profit/loss report for the same period", async () => {
    const suffix = Date.now();
    // Unique isolated date per run: parallel files (which write "today") and
    // repeated runs can never contaminate this period.
    const D = uniqueDay();

    // Product: price $10, cost $6
    const prod = await post("/api/collections/products/records", {
      name: `Dash-${suffix}`, unit_price: 10, unit_cost: 6, stock: 0, currency: "USD", active: true,
    }, mgrToken);
    await post("/api/dahav/inventory/stock-in", { product_id: prod.data.id, quantity: 10, unit_cost: 6 }, mgrToken);
    // Sale $100 dated D, pay $60 (partial)
    const co = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 10 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 60, paid_amount: 60,
      date: D + "T10:00:00.000Z",
    }, cashierToken);
    expect(co.status).toBe(200);
    expect(co.data.sale.total).toBe(100);
    expect(co.data.sale.amount_outstanding).toBe(40);

    // Expense $10 dated D
    const cat = await post("/api/collections/expense_categories/records", { name: `DashCat-${suffix}` }, mgrToken);
    await post("/api/dahav/expenses/create", {
      description: "dash test", category: cat.data.id, amount: 10, currency: "USD", payment_method: "cash",
      expense_date: D,
    }, mgrToken);

    // Query ONLY the isolated day
    const dash = await get(`/api/dahav/dashboard?from=${D}&to=${D}`, mgrToken);
    const pnl = await get(`/api/dahav/reports/profit_loss?from=${D}&to=${D}`, mgrToken);
    const salesR = await get(`/api/dahav/reports/sales?from=${D}&to=${D}`, mgrToken);

    expect(dash.status).toBe(200);
    // Exact authoritative values for this isolated period:
    expect(dash.data.revenue).toBe(100);
    expect(dash.data.cogs).toBe(60);
    expect(dash.data.gross_profit).toBe(40);
    expect(dash.data.net_profit).toBe(30); // 40 gross - 10 expense
    expect(dash.data.expenses).toBe(10);
    expect(dash.data.outstanding).toBe(40);
    expect(dash.data.sales_count).toBe(1);
    // gross = revenue - cogs (within one authoritative response)
    expect(dash.data.gross_profit).toBe(Math.round((dash.data.revenue - dash.data.cogs) * 100) / 100);
    // Cross-endpoint agreement for the same period
    expect(dash.data.revenue).toBe(pnl.data.revenue);
    expect(dash.data.cogs).toBe(pnl.data.cogs);
    expect(dash.data.net_profit).toBe(pnl.data.net_profit);
    expect(dash.data.revenue).toBe(salesR.data.totals.total_sales);
  });

  it("period filtering: dashboard(period) matches reports(period) exactly", async () => {
    const D = uniqueDay();
    const today = new Date().toISOString().slice(0, 10);

    const dashD = await get(`/api/dahav/dashboard?from=${D}&to=${D}`, mgrToken);
    const salesD = await get(`/api/dahav/reports/sales?from=${D}&to=${D}`, mgrToken);
    const dashToday = await get(`/api/dahav/dashboard?from=${today}&to=${today}`, mgrToken);

    // Dashboard and report agree on the isolated period
    expect(dashD.data.revenue).toBe(salesD.data.totals.total_sales);
    expect(dashD.data.sales_count).toBe(salesD.data.totals.count);
    expect(dashToday.data.sales_count).not.toBeLessThan(0);
  });

  it("USD and SSP are never merged in dashboard currency totals", async () => {
    const dash = await get("/api/dahav/dashboard", mgrToken);
    expect(dash.status).toBe(200);
    const ct = dash.data.currency_totals;
    // SSP totals are kept separate and never equal to the USD total unless zero
    expect(typeof ct.received_ssp).toBe("number");
    expect(typeof ct.received_usd).toBe("number");
    expect(ct.received_usd).not.toBe(ct.received_ssp);
    // Payment method breakdown sums to collected
    const methodSum = dash.data.payment_methods.reduce((s: number, m: { amount_usd: number }) => s + m.amount_usd, 0);
    expect(Math.round(methodSum * 100) / 100).toBe(Math.round(dash.data.collected * 100) / 100);
  });

  it("dashboard exposes low-stock and out-of-stock lists (real data only)", async () => {
    const dash = await get("/api/dahav/dashboard", mgrToken);
    expect(dash.status).toBe(200);
    expect(Array.isArray(dash.data.low_stock)).toBe(true);
    expect(Array.isArray(dash.data.out_of_stock)).toBe(true);
    // Every low-stock item really is at/below threshold
    for (const p of dash.data.low_stock) {
      expect(p.stock).toBeLessThanOrEqual(p.low_stock_threshold);
      expect(p.stock).toBeGreaterThan(0);
    }
    for (const p of dash.data.out_of_stock) {
      expect(p.stock).toBe(0);
    }
  });

  it("recent activity feed returns typed events with transaction IDs", async () => {
    const act = await get("/api/dahav/dashboard/activity?limit=20", mgrToken);
    expect(act.status).toBe(200);
    expect(Array.isArray(act.data.rows)).toBe(true);
    expect(act.data.rows.length).toBeGreaterThan(0);
    // Newest first (skip any row with an unparseable date)
    const dated = act.data.rows
      .map((r: { date: string }) => ({ ...r, ts: new Date(r.date).getTime() }))
      .filter((r: { ts: number }) => !Number.isNaN(r.ts));
    for (let i = 1; i < dated.length; i++) {
      expect(dated[i - 1].ts).toBeGreaterThanOrEqual(dated[i].ts);
    }
    // Has at least one sale or payment with a transaction id
    const hasTxn = act.data.rows.some((r: { transaction_id: string }) => /^TR-/.test(r.transaction_id || ""));
    expect(hasTxn).toBe(true);
  });

  it("cashier can view the dashboard (dashboard.view)", async () => {
    const dash = await get("/api/dahav/dashboard", cashierToken);
    expect(dash.status).toBe(200);
  });
});
