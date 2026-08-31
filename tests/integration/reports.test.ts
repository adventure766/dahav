/**
 * Report correctness tests.
 * Verifies that report totals match the authoritative records they summarize,
 * and that the required grand totals are present.
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

beforeAll(async () => {
  const auth = await post("/api/collections/_superusers/auth-with-password", { identity: "admin@dahav.local", password: "admin12345" });
  suToken = auth.data.token;
  const suffix = Date.now();
  const mgr = await post("/api/collections/users/records", {
    email: `rp-mgr-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "RPMgr", role: "manager",
  }, suToken);
  const cas = await post("/api/collections/users/records", {
    email: `rp-cas-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "RPCas", role: "cashier",
  }, suToken);
  const ma = await post("/api/collections/users/auth-with-password", { identity: `rp-mgr-${suffix}@dahav.local`, password: "password123" });
  mgrToken = ma.data.token;
  const ca = await post("/api/collections/users/auth-with-password", { identity: `rp-cas-${suffix}@dahav.local`, password: "password123" });
  cashierToken = ca.data.token;

  // Seed: a $30 sale (3 x $10), $100 expense, damage 5 x $2
  const prod = await post("/api/collections/products/records", {
    name: `RptProd-${suffix}`, unit_price: 10, unit_cost: 4, stock: 50, currency: "USD", active: true,
  }, mgrToken);
  const checkout = await post("/api/dahav/pos/checkout", {
    items: [{ product_id: prod.data.id, quantity: 3 }],
    payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 30,
  }, cashierToken);
  expect(checkout.status).toBe(200);

  const cat = await post("/api/collections/expense_categories/records", { name: `RptCat-${suffix}` }, mgrToken);
  const exp = await post("/api/dahav/expenses/create", {
    description: "Test expense", category: cat.data.id, amount: 100, currency: "USD", payment_method: "cash",
  }, mgrToken);
  expect(exp.status).toBe(200);

  const dmg = await post("/api/dahav/inventory/damage", { product_id: prod.data.id, quantity: 5, reason: "report test" }, mgrToken);
  expect(dmg.status).toBe(200);
});

describe("reports", () => {
  it("cashier cannot access reports", async () => {
    const r = await get("/api/dahav/reports/sales", cashierToken);
    expect(r.status).toBe(403);
  });

  it("sales report has grand total matching the sale", async () => {
    const r = await get("/api/dahav/reports/sales", mgrToken);
    expect(r.status).toBe(200);
    // The DB accumulates sales across test runs, so verify the seeded sale row
    // and that grand totals are consistent (>= the seeded amounts).
    expect(r.data.totals.total_sales).toBeGreaterThanOrEqual(30);
    expect(r.data.totals.total_quantity).toBeGreaterThanOrEqual(3);
    const row = r.data.rows.find((x: { sale_id: string }) => x.sale_id.includes("SALE-"));
    expect(row).toBeTruthy();
    expect(row.transaction_id).toMatch(/^TR-/);
    const seeded = r.data.rows.find((x: { total: number }) => x.total === 30);
    expect(seeded).toBeTruthy();
  });

  it("payment report separates USD and SSP totals", async () => {
    const r = await get("/api/dahav/reports/payments", mgrToken);
    expect(r.status).toBe(200);
    expect(r.data.totals.total_usd).toBeGreaterThanOrEqual(30);
    expect(typeof r.data.totals.total_ssp).toBe("number");
    // SSP and USD are never summed into one number
    expect(r.data.totals.total_usd).not.toBe(r.data.totals.total_ssp);
  });

  it("expense report grand total matches the $100 expense", async () => {
    const r = await get("/api/dahav/reports/expenses", mgrToken);
    expect(r.status).toBe(200);
    expect(r.data.totals.total_usd).toBeGreaterThanOrEqual(100);
    const row = r.data.rows.find((x: { expense_id: string }) => x.expense_id.includes("EXP-"));
    expect(row).toBeTruthy();
    expect(row.amount_usd).toBeGreaterThanOrEqual(100);
    expect(row.transaction_id).toMatch(/^TR-/);
  });

  it("damage report shows cost-basis loss", async () => {
    const r = await get("/api/dahav/reports/damage", mgrToken);
    expect(r.status).toBe(200);
    const seeded = r.data.rows.find((x: { damage_id: string }) => x.damage_id.includes("DMG-"));
    expect(seeded).toBeTruthy();
    // product cost was $4, 5 units damaged -> $20
    const costBasisRow = r.data.rows.find((x: { unit_cost: number; quantity: number }) => x.unit_cost === 4 && x.quantity === 5);
    expect(costBasisRow).toBeTruthy();
    expect(costBasisRow.total_cost).toBe(20);
    expect(r.data.totals.total_cost).toBeGreaterThanOrEqual(20);
  });

  it("profit/loss report computes from authoritative records", async () => {
    const r = await get("/api/dahav/reports/profit_loss", mgrToken);
    expect(r.status).toBe(200);
    // Revenue >= $30, COGS from the seeded 3 x $4 = $12 sale exists
    expect(r.data.revenue).toBeGreaterThanOrEqual(30);
    expect(r.data.cogs).toBeGreaterThanOrEqual(12);
    expect(typeof r.data.gross_profit).toBe("number");
    expect(r.data.operating_expenses).toBeGreaterThanOrEqual(100);
    expect(r.data.other_losses).toBeGreaterThanOrEqual(20);
    expect(typeof r.data.net_profit).toBe("number");
  });

  it("inventory report has total value", async () => {
    const r = await get("/api/dahav/reports/inventory", mgrToken);
    expect(r.status).toBe(200);
    expect(typeof r.data.totals.total_value).toBe("number");
    expect(r.data.totals.total_products).toBeGreaterThan(0);
  });

  it("customer debt report has grand total", async () => {
    const r = await get("/api/dahav/reports/customer_debt", mgrToken);
    expect(r.status).toBe(200);
    expect(typeof r.data.totals.total_outstanding).toBe("number");
    expect(typeof r.data.totals.customers_with_debt).toBe("number");
  });

  it("payroll report has USD/SSP totals", async () => {
    const r = await get("/api/dahav/reports/payroll", mgrToken);
    expect(r.status).toBe(200);
    expect(typeof r.data.totals.total_usd).toBe("number");
    expect(typeof r.data.totals.total_ssp).toBe("number");
  });

  it("dashboard matches the authoritative reports (no independent math)", async () => {
    const [dash, salesR, pnlR] = await Promise.all([
      get("/api/dahav/dashboard", mgrToken),
      get("/api/dahav/reports/sales", mgrToken),
      get("/api/dahav/reports/profit_loss", mgrToken),
    ]);
    expect(dash.status).toBe(200);
    expect(salesR.status).toBe(200);
    expect(pnlR.status).toBe(200);

    // Dashboard revenue == sales report total == P&L revenue
    expect(dash.data.revenue).toBe(salesR.data.totals.total_sales);
    expect(dash.data.revenue).toBe(pnlR.data.revenue);
    expect(dash.data.cogs).toBe(pnlR.data.cogs);
    expect(dash.data.gross_profit).toBe(pnlR.data.gross_profit);
    expect(dash.data.net_profit).toBe(pnlR.data.net_profit);

    // Dashboard outstanding == customer debt report total outstanding
    const debtR = await get("/api/dahav/reports/customer_debt", mgrToken);
    expect(dash.data.outstanding).toBe(debtR.data.totals.total_outstanding);

    // Dashboard damage loss == damage report total cost
    const dmgR = await get("/api/dahav/reports/damage", mgrToken);
    expect(dash.data.damage_loss).toBe(dmgR.data.totals.total_cost);
  });
});
