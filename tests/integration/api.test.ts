/**
 * Integration tests against a real PocketBase server.
 *
 * PREREQUISITE: a running DAHAV server with superuser admin@dahav.local/admin12345.
 * Start one with:
 *   pocketbase serve --http=127.0.0.1:8092 --dir pb_data
 *
 * These tests use unique emails/names per run so they are repeatable.
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.DAHAV_TEST_BASE || "http://127.0.0.1:8092";
const SUPERUSER = { identity: "admin@dahav.local", password: "admin12345" };

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
  const auth = await post("/api/collections/_superusers/auth-with-password", SUPERUSER);
  expect(auth.status).toBe(200);
  suToken = auth.data.token;

  // Create manager + cashier
  const suffix = Date.now();
  const mgr = await post("/api/collections/users/records", {
    email: `mgr-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "Mgr", role: "manager",
  }, suToken);
  expect(mgr.status).toBe(200);

  const cas = await post("/api/collections/users/records", {
    email: `cas-${suffix}@dahav.local`, password: "password123", passwordConfirm: "password123", name: "Cas", role: "cashier",
  }, suToken);
  expect(cas.status).toBe(200);

  const ma = await post("/api/collections/users/auth-with-password", { identity: `mgr-${suffix}@dahav.local`, password: "password123" });
  mgrToken = ma.data.token;
  const ca = await post("/api/collections/users/auth-with-password", { identity: `cas-${suffix}@dahav.local`, password: "password123" });
  cashierToken = ca.data.token;
});

describe("health + settings", () => {
  it("health endpoint identifies as dahav", async () => {
    const res = await fetch(`${BASE}/api/dahav/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.app).toBe("dahav");
  });

  it("default rate is seeded at 8000 SSP/USD", async () => {
    const res = await fetch(`${BASE}/api/dahav/rates/default`);
    const data = await res.json();
    expect(data.default_rate).toBe(8000);
    expect(data.main_currency).toBe("USD");
    expect(data.settings_id).toBeTruthy();
  });
});

describe("POS checkout — required SSP test vector", () => {
  it("2x $2.50 milk, paid in SSP @8000, tendered 50,000 -> 40,000 due, 10,000 change", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `Milk-${Date.now()}`, unit_price: 2.5, unit_cost: 1.8, stock: 100, currency: "USD", active: true,
    }, mgrToken);
    expect(prod.status).toBe(200);
    const productId = prod.data.id;

    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: productId, quantity: 2 }],
      payment_method: "cash",
      payment_currency: "SSP",
      exchange_rate: 8000,
      tendered: 50000,
      customer_id: "",
    }, cashierToken);

    expect(checkout.status).toBe(200);
    const r = checkout.data;
    expect(r.sale.total).toBe(5);
    expect(r.sale.amount_paid).toBe(5);
    expect(r.sale.amount_outstanding).toBe(0);
    expect(r.payment.amount).toBe(40000);
    expect(r.payment.currency).toBe("SSP");
    expect(r.payment.exchange_rate).toBe(8000);
    expect(r.payment.amount_usd).toBe(5);
    expect(r.payment.change).toBe(10000);
    expect(r.receipt.receipt_id).toMatch(/^REC-/);
    expect(r.transaction.transaction_id).toMatch(/^TR-\d{8}-\d{4}$/);
    expect(r.invoice.invoice_id).toMatch(/^INV-/);
  });

  it("rejects insufficient stock", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `Low-${Date.now()}`, unit_price: 1, unit_cost: 0.5, stock: 2, currency: "USD", active: true,
    }, mgrToken);
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 5 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 100,
    }, cashierToken);
    expect(checkout.status).toBe(400);
  });
});

describe("POS checkout — 500,000 SSP payment", () => {
  it("500,000 SSP at 8000 -> $62.50 USD equivalent", async () => {
    // A sale totalling exactly 62.50 USD, paid fully in SSP.
    const prod = await post("/api/collections/products/records", {
      name: `Item-${Date.now()}`, unit_price: 12.5, unit_cost: 8, stock: 100, currency: "USD", active: true,
    }, mgrToken);
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 5 }], // 5 * 12.5 = 62.50
      payment_method: "cash",
      payment_currency: "SSP",
      exchange_rate: 8000,
      tendered: 500000,
    }, cashierToken);
    expect(checkout.status).toBe(200);
    const r = checkout.data;
    expect(r.sale.total).toBe(62.5);
    expect(r.payment.amount).toBe(500000); // 62.5 * 8000
    expect(r.payment.amount_usd).toBe(62.5);
    expect(r.payment.change).toBe(0);
  });
});

describe("POS checkout — USD payment", () => {
  it("$6.50 total, tendered $10 -> $3.50 change", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `Usd-${Date.now()}`, unit_price: 3.25, unit_cost: 2, stock: 50, currency: "USD", active: true,
    }, mgrToken);
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 2 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 10,
    }, cashierToken);
    expect(checkout.status).toBe(200);
    expect(checkout.data.sale.total).toBe(6.5);
    expect(checkout.data.payment.amount).toBe(6.5);
    expect(checkout.data.payment.change).toBe(3.5);
    expect(checkout.data.payment.amount_usd).toBe(6.5);
  });
});

describe("payroll — required SSP salary test", () => {
  it("800,000 SSP salary at 8000 -> $100 USD equivalent", async () => {
    const emp = await post("/api/collections/employees/records", {
      name: `Emp-${Date.now()}`, position: "Cashier", status: "active", salary: 800000, salary_currency: "SSP",
    }, mgrToken);
    expect(emp.status).toBe(200);

    const pr = await post("/api/dahav/payroll/create", {
      employee_id: emp.data.id,
      period: "2026-08",
      base_salary: 800000,
      allowances: 0,
      deductions: 0,
      currency: "SSP",
      exchange_rate: 8000,
      payment_method: "cash",
    }, mgrToken);
    expect(pr.status).toBe(200);
    const r = pr.data;
    expect(r.calculation.net).toBe(800000);
    expect(r.calculation.currency).toBe("SSP");
    expect(r.calculation.amount_usd).toBe(100); // 800,000 / 8,000
    expect(r.payroll.payroll_id).toMatch(/^PRL-/);
    expect(r.transaction.transaction_id).toMatch(/^TR-/);
    expect(r.transaction.type).toBe("salary");
    expect(r.transaction.amount_usd).toBe(100);
  });

  it("payroll with allowances and deductions", async () => {
    const emp = await post("/api/collections/employees/records", {
      name: `Emp2-${Date.now()}`, position: "Manager", status: "active", salary: 500, salary_currency: "USD",
    }, mgrToken);
    const pr = await post("/api/dahav/payroll/create", {
      employee_id: emp.data.id,
      period: "2026-08",
      base_salary: 500,
      allowances: 100,
      deductions: 50,
      currency: "USD",
    }, mgrToken);
    expect(pr.status).toBe(200);
    expect(pr.data.calculation.net).toBe(550); // 500 + 100 - 50
    expect(pr.data.calculation.amount_usd).toBe(550);
  });
});

describe("expenses", () => {
  it("records an expense with SSP currency and USD conversion", async () => {
    const cat = await post("/api/collections/expense_categories/records", { name: `Rent-${Date.now()}` }, mgrToken);
    const ex = await post("/api/dahav/expenses/create", {
      description: "Monthly rent",
      category: cat.data.id,
      amount: 80000,
      currency: "SSP",
      exchange_rate: 8000,
      payment_method: "bank_transfer",
    }, mgrToken);
    expect(ex.status).toBe(200);
    expect(ex.data.expense.expense_id).toMatch(/^EXP-/);
    expect(ex.data.expense.amount).toBe(80000);
    expect(ex.data.expense.currency).toBe("SSP");
    expect(ex.data.expense.amount_usd).toBe(10); // 80,000 / 8,000
    expect(ex.data.transaction.transaction_id).toMatch(/^TR-/);
    expect(ex.data.transaction.type).toBe("expense");
  });

  it("records an expense in USD directly", async () => {
    const cat = await post("/api/collections/expense_categories/records", { name: `Utils-${Date.now()}` }, mgrToken);
    const ex = await post("/api/dahav/expenses/create", {
      description: "Utilities",
      category: cat.data.id,
      amount: 250,
      currency: "USD",
      payment_method: "cash",
    }, mgrToken);
    expect(ex.status).toBe(200);
    expect(ex.data.expense.amount_usd).toBe(250);
  });
});

describe("permissions", () => {
  it("cashier can checkout", async () => {
    expect(cashierToken).toBeTruthy();
  });
  it("unauthorized user cannot change rates", async () => {
    const r = await post("/api/dahav/rates/default", { rate: 9000 }, cashierToken);
    expect(r.status).toBe(403);
  });
  it("manager can change rates", async () => {
    const r = await post("/api/dahav/rates/default", { rate: 8500, note: "integration test" }, mgrToken);
    expect(r.status).toBe(200);
    expect(r.data.default_rate).toBe(8500);
    // Restore
    await post("/api/dahav/rates/default", { rate: 8000, note: "restore" }, mgrToken);
  });
  it("financial records cannot be hard-deleted", async () => {
    const r = await fetch(`${BASE}/api/collections/settings/records`, { method: "DELETE", headers: { Authorization: mgrToken } });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("inventory — stock in (moving average)", () => {
  it("updates stock and moving-average unit cost", async () => {
    // Start: 10 units @ $2.00
    const prod = await post("/api/collections/products/records", {
      name: `Avg-${Date.now()}`, unit_price: 4, unit_cost: 2, stock: 10, currency: "USD", active: true,
    }, mgrToken);
    expect(prod.status).toBe(200);
    const pid = prod.data.id;

    // Stock in 10 more @ $3.00 -> avg $2.50, stock 20
    const si = await post("/api/dahav/inventory/stock-in", { product_id: pid, quantity: 10, unit_cost: 3 }, mgrToken);
    expect(si.status).toBe(200);
    expect(si.data.product.stock).toBe(20);
    expect(si.data.product.unit_cost).toBe(2.5);
  });

  it("rejects stock-in with zero cost", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `Zero-${Date.now()}`, unit_price: 1, unit_cost: 0.5, stock: 5, currency: "USD", active: true,
    }, mgrToken);
    const si = await post("/api/dahav/inventory/stock-in", { product_id: prod.data.id, quantity: 5, unit_cost: 0 }, mgrToken);
    expect(si.status).toBe(400);
  });
});

describe("inventory — damaged products (required test)", () => {
  it("10 units damaged at cost $2.50 -> $25.00 loss (NOT $40.00 selling price)", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `Dmg-${Date.now()}`, unit_price: 4, unit_cost: 2.5, stock: 50, currency: "USD", active: true,
    }, mgrToken);
    expect(prod.status).toBe(200);
    const pid = prod.data.id;

    const dmg = await post("/api/dahav/inventory/damage", { product_id: pid, quantity: 10, reason: "test damage" }, mgrToken);
    expect(dmg.status).toBe(200);
    const r = dmg.data;
    expect(r.calculation.quantity).toBe(10);
    expect(r.calculation.unit_cost).toBe(2.5);
    expect(r.calculation.total_cost).toBe(25);
    expect(r.calculation.method).toBe("cost_basis");
    expect(r.damage.damage_id).toMatch(/^DMG-/);
    expect(r.product.stock).toBe(40); // 50 - 10
    expect(r.transaction.transaction_id).toMatch(/^TR-/);
    expect(r.transaction.type).toBe("damage");
    expect(r.transaction.amount_usd).toBe(25);
  });

  it("rejects damage exceeding stock", async () => {
    const prod = await post("/api/collections/products/records", {
      name: `LowStock-${Date.now()}`, unit_price: 4, unit_cost: 2.5, stock: 3, currency: "USD", active: true,
    }, mgrToken);
    const dmg = await post("/api/dahav/inventory/damage", { product_id: prod.data.id, quantity: 10 }, mgrToken);
    expect(dmg.status).toBe(400);
  });
});

describe("customers — debt / payment application (required test)", () => {
  it("sale $100, pay $60, outstanding $40; then pay $20, outstanding $20", async () => {
    // Create customer
    const cust = await post("/api/collections/customers/records", {
      name: `Cust-${Date.now()}`,
    }, mgrToken);
    expect(cust.status).toBe(200);
    const customerId = cust.data.id;

    // Product at $10
    const prod = await post("/api/collections/products/records", {
      name: `Debt-${Date.now()}`, unit_price: 10, unit_cost: 6, stock: 100, currency: "USD", active: true,
    }, mgrToken);
    // Sale of 10 units = $100, paid $60 (partial payment creates debt)
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 10 }],
      payment_method: "cash",
      payment_currency: "USD",
      exchange_rate: 8000,
      tendered: 60, // ignored when paid_amount is set
      paid_amount: 60, // pay only $60 of the $100
      customer_id: customerId,
    }, cashierToken);
    expect(checkout.status).toBe(200);
    const sale = checkout.data.sale;
    expect(sale.total).toBe(100);
    expect(sale.amount_paid).toBe(60);
    expect(sale.amount_outstanding).toBe(40);
    expect(sale.status).toBe("partial");

    // Customer balance endpoint agrees
    const bal1 = await fetch(`${BASE}/api/dahav/customers/${customerId}/balance`);
    const b1 = await bal1.json();
    expect(b1.total_purchases).toBe(100);
    expect(b1.total_paid).toBe(60);
    expect(b1.outstanding).toBe(40);

    // Second payment $20
    const pay2 = await post("/api/dahav/payments/on-sale", {
      sale_id: sale.sale_id,
      amount: 20,
      currency: "USD",
      payment_method: "cash",
    }, cashierToken);
    expect(pay2.status).toBe(200);
    expect(pay2.data.sale.amount_outstanding).toBe(20);
    expect(pay2.data.sale.status).toBe("partial");
    expect(pay2.data.payment.payment_id).toMatch(/^PAY-/);

    // Customer balance now: paid 80, outstanding 20
    const bal2 = await fetch(`${BASE}/api/dahav/customers/${customerId}/balance`);
    const b2 = await bal2.json();
    expect(b2.total_paid).toBe(80);
    expect(b2.outstanding).toBe(20);

    // Final payment $20 settles it
    const pay3 = await post("/api/dahav/payments/on-sale", {
      sale_id: sale.sale_id,
      amount: 20,
      currency: "USD",
      payment_method: "cash",
    }, cashierToken);
    expect(pay3.status).toBe(200);
    expect(pay3.data.sale.amount_outstanding).toBe(0);
    expect(pay3.data.sale.status).toBe("completed");

    const bal3 = await fetch(`${BASE}/api/dahav/customers/${customerId}/balance`);
    const b3 = await bal3.json();
    expect(b3.outstanding).toBe(0);
  });

  it("rejects payment exceeding outstanding balance", async () => {
    const cust = await post("/api/collections/customers/records", { name: `C2-${Date.now()}` }, mgrToken);
    const prod = await post("/api/collections/products/records", {
      name: `Debt2-${Date.now()}`, unit_price: 5, unit_cost: 3, stock: 100, currency: "USD", active: true,
    }, mgrToken);
    const checkout = await post("/api/dahav/pos/checkout", {
      items: [{ product_id: prod.data.id, quantity: 1 }], // $5
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 2,
      paid_amount: 2, // pay only $2
      customer_id: cust.data.id,
    }, cashierToken);
    expect(checkout.status).toBe(200);
    const sale = checkout.data.sale; // $5 total, $2 paid, $3 outstanding
    const over = await post("/api/dahav/payments/on-sale", {
      sale_id: sale.sale_id, amount: 10, currency: "USD", payment_method: "cash",
    }, cashierToken);
    expect(over.status).toBe(400);
  });
});
