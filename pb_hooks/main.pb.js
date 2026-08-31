/**
 * DAHAV pb_hooks entry point (main.pb.js).
 * Loaded by PocketBase at serve time.
 *
 * IMPORTANT goja constraints:
 *  - `require()` only works INSIDE handler bodies, not at file top-level.
 *  - Each handler runs in an isolated scope, so module state is shared only
 *    via the require registry.
 *  - Only CJS modules are supported.
 */

// --- health endpoint (used by LAN discovery verification) ---
routerAdd("GET", "/api/dahav/health", (c) => {
  return c.json(200, { ok: true, app: "dahav", version: "0.1.0", time: new Date().toISOString() });
});

// --- default exchange rate + settings ---
routerAdd("GET", "/api/dahav/rates/default", (c) => {
  const services = require(`${__hooks}/lib/services.cjs`);
  const s = services.getSettings($app);
  return c.json(200, {
    default_rate: s ? Number(s.get("default_rate")) : 8000,
    main_currency: s ? String(s.get("currency")) : "USD",
    settings_id: s ? s.id : null,
  });
});

// --- create staff user (owner-only OR superuser) ---
routerAdd("POST", "/api/dahav/users/create", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const services = require(`${__hooks}/lib/services.cjs`);
  const isSuper = c.hasSuperuserAuth ? c.hasSuperuserAuth() : false;
  const user = c.auth;
  if (!isSuper && (!user || !constants.can(user.get("role"), "users.manage"))) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  if (!body || !body.email || !body.password || !body.name || !body.role) {
    return c.json(400, { error: "email, password, name, role are required" });
  }
  if (!constants.ROLES[String(body.role).toUpperCase()]) {
    return c.json(400, { error: "Invalid role" });
  }
  try {
    const col = $app.findCollectionByNameOrId("users");
    const rec = new Record(col);
    rec.set("email", body.email);
    rec.set("password", body.password);
    rec.set("passwordConfirm", body.password);
    rec.set("name", body.name);
    rec.set("role", body.role);
    rec.set("phone", body.phone || "");
    rec.set("position", body.position || "");
    rec.set("active", body.active === undefined ? true : !!body.active);
    if (body.joined_at) rec.set("joined_at", body.joined_at);
    $app.save(rec);
    services.audit($app, { collection: "users", record_id: rec.id, action: "create", reason: "staff user created", after: { email: body.email, role: body.role }, by: (user && user.id) || "" });
    return c.json(200, { id: rec.id, email: rec.get("email"), role: rec.get("role"), name: rec.get("name") });
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- change default exchange rate ---
routerAdd("POST", "/api/dahav/rates/default", (c) => {
  const services = require(`${__hooks}/lib/services.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "rates.edit")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  const rate = Number(body.rate);
  if (!rate || rate <= 0) return c.json(400, { error: "Invalid rate" });
  const s = services.getSettings($app);
  if (!s) return c.json(400, { error: "Settings not found" });
  const before = Number(s.get("default_rate"));
  s.set("default_rate", rate);
  $app.save(s);
  const col = $app.findCollectionByNameOrId("exchange_rates");
  const rec = new Record(col);
  rec.set("rate", rate);
  rec.set("note", body.note || "Default rate updated");
  rec.set("set_by", user.id);
  $app.save(rec);
  services.audit($app, { collection: "settings", record_id: s.id, action: "update", reason: "default rate change", before: { default_rate: before }, after: { default_rate: rate }, by: user.id });
  return c.json(200, { default_rate: rate });
});

// --- POS checkout (authoritative calculation + persist) ---
routerAdd("POST", "/api/dahav/pos/checkout", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "pos.sell")) {
    return c.json(403, { error: "Not authorized to sell" });
  }
  const body = c.requestInfo().body;
  if (!body || typeof body !== "object") {
    return c.json(400, { error: "Invalid request body" });
  }
  try {
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executePosCheckout(txApp, Object.assign({}, body, { cashier_id: user.id }));
    });
    return c.json(200, result);
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- register an expense ---
routerAdd("POST", "/api/dahav/expenses/create", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "expenses.create")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  try {
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executeExpense(txApp, Object.assign({}, body, { created_by: user.id }));
    });
    return c.json(200, result);
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- register a payment against an existing sale ---
routerAdd("POST", "/api/dahav/payments/on-sale", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "payments.create")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  try {
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executePaymentOnSale(txApp, Object.assign({}, body, { by: user.id }));
    });
    return c.json(200, result);
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- customer balance (derived from authoritative records) ---
routerAdd("GET", "/api/dahav/customers/{id}/balance", (c) => {
  try {
    const engine = require(`${__hooks}/engine/index.cjs`);
    const id = c.request.pathValue("id");
    const sales = $app.findRecordsByFilter("sales", `customer = '${id}'`, "", 1000, 0);
    const payments = $app.findRecordsByFilter("payments", `customer = '${id}'`, "", 1000, 0);
    const balance = engine.customerBalance(
      sales.map((s) => ({ total_usd: Number(s.get("total")), amount_outstanding: Number(s.get("amount_outstanding")) || 0, status: s.get("voided") ? "void" : "completed" })),
      payments.map((p) => ({ amount_usd: Number(p.get("amount_usd")), status: p.get("status") || "paid" })),
    );
    return c.json(200, balance);
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- register a payroll payment ---
routerAdd("POST", "/api/dahav/payroll/create", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "payroll.create")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  try {
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executePayroll(txApp, Object.assign({}, body, { by: user.id }));
    });
    return c.json(200, result);
  } catch (err) {
    return c.json(400, { error: String(err && err.message || err) });
  }
});

// --- reports (manager/owner) ---
// NOTE: each route handler runs in an isolated goja context, so the report
// function name must be inlined — closures over outer vars don't work.
routerAdd("GET", "/api/dahav/reports/sales", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.salesReport($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/payments", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.paymentReport($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/expenses", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.expenseReport($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/inventory", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const result = reports.inventoryReport($app);
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/damage", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.damageReport($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/profit_loss", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.profitLossReport($app, { from: q.from, to: q.to, currency: q.currency || "USD" });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/customer_debt", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const result = reports.customerDebtReport($app);
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

routerAdd("GET", "/api/dahav/reports/payroll", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "reports.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.payrollReport($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard summary (cashier can view) ---
routerAdd("GET", "/api/dahav/dashboard", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.dashboardSummary($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard performance chart data ---
routerAdd("GET", "/api/dahav/dashboard/performance", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.revenueOverTime($app, { from: q.from, to: q.to, granularity: q.granularity });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard previous-period summary (for vs-previous deltas) ---
routerAdd("GET", "/api/dahav/dashboard/previous", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.previousPeriodSummary($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard recent transactions (from the ledger) ---
routerAdd("GET", "/api/dahav/dashboard/transactions", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.recentTransactions($app, q.limit);
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard top selling products ---
routerAdd("GET", "/api/dahav/dashboard/top-products", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.topSellingProducts($app, { from: q.from, to: q.to, limit: q.limit });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard expense-by-category breakdown ---
routerAdd("GET", "/api/dahav/dashboard/expenses-by-category", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.expensesByCategory($app, { from: q.from, to: q.to });
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- dashboard recent activity feed ---
routerAdd("GET", "/api/dahav/dashboard/activity", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "dashboard.view")) return c.json(403, { error: "Not authorized" });
  try {
    const reports = require(`${__hooks}/lib/reports.cjs`);
    const q = c.requestInfo().query || {};
    const result = reports.recentActivity($app, q.limit);
    return c.json(200, result);
  } catch (err) { return c.json(400, { error: String(err && err.message || err) }); }
});

// --- verify a candidate server is a real DAHAV backend ---
routerAdd("POST", "/api/dahav/verify", (c) => {
  const body = c.requestInfo().body;
  const url = body && body.url;
  if (!url) return c.json(400, { error: "url required" });
  try {
    const healthUrl = String(url).replace(/\/+$/, "") + "/api/dahav/health";
    const res = $http.send({ method: "GET", url: healthUrl, timeout: 5 });
    if (res.statusCode === 200) {
      const data = JSON.parse(res.raw || "{}");
      if (data && data.app === "dahav") {
        return c.json(200, { ok: true, app: "dahav", version: data.version });
      }
    }
    return c.json(400, { error: "Not a valid DAHAV server" });
  } catch (err) {
    return c.json(400, { error: "Could not reach server: " + String(err) });
  }
});

// --- guard: sensitive collections via request hooks ---
onRecordCreateRequest((e) => {
  const col = e.collection.name;
  if (col === "settings" || col === "exchange_rates" || col === "counters") {
    const constants = require(`${__hooks}/lib/constants.cjs`);
    const u = $app.authStore().model;
    if (!u || !constants.can(u.get("role"), "settings.edit")) {
      throw new ForbiddenError("Not authorized");
    }
  }
  e.next();
});

// ------------------------------------------------------------------ *
// Cascade delete endpoints — safe, transactional, owner/manager only.
// Deleting a financial record removes its full graph so the ledger stays
// consistent (no orphaned children, no double-counted money).
//
// NOTE: helpers live in lib/delete-helpers.cjs and are require()d inside
// each handler (goja handlers cannot see top-level function declarations).
// ------------------------------------------------------------------ *

// --- delete a sale: items, payments, receipts, invoice, txn ---
routerAdd("DELETE", "/api/dahav/records/sales/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "sales.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const sale = txApp.findRecordById("sales", id);
      if (!sale) return c.json(404, { error: "Sale not found" });
      // Restore inventory: for each sale item, add the quantity back to stock
      // and push a FIFO layer at the item's recorded unit cost.
      const items = txApp.findRecordsByFilter("sale_items", `sale = '${id}'`, "", 100000, 0);
      for (const it of items) {
        const productId = it.get("product");
        const qty = Number(it.get("quantity")) || 0;
        const unitCost = Number(it.get("unit_cost")) || 0;
        if (productId && qty > 0) {
          const prod = txApp.findRecordById("products", productId);
          if (prod) {
            prod.set("stock", (Number(prod.get("stock")) || 0) + qty);
            txApp.save(prod);
            const layerCol = txApp.findCollectionByNameOrId("inventory_layers");
            const layer = new Record(layerCol);
            layer.set("product", productId);
            layer.set("quantity", qty);
            layer.set("remaining_quantity", qty);
            layer.set("unit_cost", unitCost);
            layer.set("reference", "restored-" + id);
            layer.set("notes", "Restored after deleting sale " + sale.get("sale_id"));
            txApp.save(layer);
          }
        }
      }
      dh.deleteChildRecords(txApp, "sale_items", `sale = '${id}'`);
      dh.deleteChildRecords(txApp, "payments", `sale = '${id}'`);
      dh.deleteChildRecords(txApp, "receipts", `sale = '${id}'`);
      dh.deleteChildRecords(txApp, "invoices", `sale = '${id}'`);
      dh.deleteChildRecords(txApp, "inventory_movements", `reference = '${sale.get("sale_id")}'`);
      const txnId = sale.get("transaction");
      txApp.delete(sale);
      if (txnId) {
        try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) { /* already gone */ }
      }
      return c.json(200, { ok: true, deleted: "sale", id, restored_items: items.length });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete an expense: also its transaction ---
routerAdd("DELETE", "/api/dahav/records/expenses/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "expenses.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("expenses", id);
      if (!rec) return c.json(404, { error: "Expense not found" });
      const txnId = rec.get("transaction");
      txApp.delete(rec);
      if (txnId) {
        try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) { /* already gone */ }
      }
      return c.json(200, { ok: true, deleted: "expense", id });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a payment: also its transaction (NOT the sale) ---
routerAdd("DELETE", "/api/dahav/records/payments/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "payments.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("payments", id);
      if (!rec) return c.json(404, { error: "Payment not found" });
      const txnId = rec.get("transaction");
      // Delete the payment's receipt too (one receipt per payment)
      dh.deleteChildRecords(txApp, "receipts", `payment = '${id}'`);
      txApp.delete(rec);
      if (txnId) {
        try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) { /* already gone */ }
      }
      return c.json(200, { ok: true, deleted: "payment", id });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a damage record: also its transaction + restore stock + layer ---
routerAdd("DELETE", "/api/dahav/records/damage/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "damage.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("damage_records", id);
      if (!rec) return c.json(404, { error: "Damage record not found" });
      const txnId = rec.get("transaction");
      const productId = rec.get("product");
      const qty = Number(rec.get("quantity")) || 0;
      const unitCost = Number(rec.get("unit_cost")) || 0;
      // Restore stock
      if (productId && qty > 0) {
        const prod = txApp.findRecordById("products", productId);
        if (prod) {
          prod.set("stock", (Number(prod.get("stock")) || 0) + qty);
          txApp.save(prod);
        }
        // Restore a FIFO layer with the same cost
        const layers = txApp.findRecordsByFilter("inventory_layers", `product = '${productId}'`, "created", 100000, 0);
        const col = txApp.findCollectionByNameOrId("inventory_layers");
        const layer = new Record(col);
        layer.set("product", productId);
        layer.set("quantity", qty);
        layer.set("remaining_quantity", qty);
        layer.set("unit_cost", unitCost);
        layer.set("reference", "restored-" + id);
        layer.set("notes", "Restored after deleting damage record " + rec.get("damage_id"));
        txApp.save(layer);
      }
      // Delete the damage movement
      dh.deleteChildRecords(txApp, "inventory_movements", `reference = '${rec.get("damage_id")}'`);
      txApp.delete(rec);
      if (txnId) {
        try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) { /* already gone */ }
      }
      return c.json(200, { ok: true, deleted: "damage", id, restored_qty: qty });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a product: remove layers + movements, but BLOCK if sale history ---
routerAdd("DELETE", "/api/dahav/records/products/{id}", (c) => {
  try {
    const constants = require(`${__hooks}/lib/constants.cjs`);
    const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
    const u = c.auth;
    if (!u || !constants.can(u.get("role"), "products.delete")) {
      return c.json(403, { error: "Not authorized" });
    }
    const id = c.request.pathValue("id");
    return dh.deleteInTxn($app, (txApp) => {
      const prod = txApp.findRecordById("products", id);
      if (!prod) return c.json(404, { error: "Product not found" });
      const saleItems = txApp.findRecordsByFilter("sale_items", `product = '${id}'`, "", 1, 0);
      if (saleItems.length > 0) {
        return c.json(400, { error: "This product has sales history. Delete its sales first, then delete the product." });
      }
      dh.deleteChildRecords(txApp, "inventory_layers", `product = '${id}'`);
      dh.deleteChildRecords(txApp, "inventory_movements", `product = '${id}'`);
      dh.deleteChildRecords(txApp, "damage_records", `product = '${id}'`);
      txApp.delete(prod);
      return c.json(200, { ok: true, deleted: "product", id });
    });
  } catch (err) {
    console.log("DELETE product ERROR:", String(err && err.stack || err && err.message || err));
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a payroll record: also its transaction ---
routerAdd("DELETE", "/api/dahav/records/payroll/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "payroll.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("payroll", id);
      if (!rec) return c.json(404, { error: "Payroll record not found" });
      const txnId = rec.get("transaction");
      txApp.delete(rec);
      if (txnId) {
        try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) { /* already gone */ }
      }
      return c.json(200, { ok: true, deleted: "payroll", id });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a transaction (standalone ledger entry, e.g. manual/adjustment) ---
routerAdd("DELETE", "/api/dahav/records/transactions/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "transactions.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("transactions", id);
      if (!rec) return c.json(404, { error: "Transaction not found" });
      txApp.delete(rec);
      return c.json(200, { ok: true, deleted: "transaction", id });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a customer: also their outstanding payment links (sales stay) ---
routerAdd("DELETE", "/api/dahav/records/customers/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "customers.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("customers", id);
      if (!rec) return c.json(404, { error: "Customer not found" });
      // Orphan-link sales to this customer
      const sales = txApp.findRecordsByFilter("sales", `customer = '${id}'`, "", 100000, 0);
      for (const s of sales) {
        s.set("customer", "");
        txApp.save(s);
      }
      dh.deleteChildRecords(txApp, "payments", `customer = '${id}'`);
      txApp.delete(rec);
      return c.json(200, { ok: true, deleted: "customer", id, unlinked_sales: sales.length });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete an employee: also their payroll records + transactions ---
routerAdd("DELETE", "/api/dahav/records/employees/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "employees.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("employees", id);
      if (!rec) return c.json(404, { error: "Employee not found" });
      const payrolls = txApp.findRecordsByFilter("payroll", `employee = '${id}'`, "", 100000, 0);
      for (const p of payrolls) {
        const txnId = p.get("transaction");
        txApp.delete(p);
        if (txnId) { try { txApp.delete(txApp.findRecordById("transactions", txnId)); } catch (err) {} }
      }
      txApp.delete(rec);
      return c.json(200, { ok: true, deleted: "employee", id, payroll_deleted: payrolls.length });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// --- delete a supplier (expenses keep but unlink) ---
routerAdd("DELETE", "/api/dahav/records/suppliers/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "suppliers.delete")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("suppliers", id);
      if (!rec) return c.json(404, { error: "Supplier not found" });
      const exps = txApp.findRecordsByFilter("expenses", `supplier = '${id}'`, "", 100000, 0);
      for (const ex of exps) { ex.set("supplier", ""); txApp.save(ex); }
      txApp.delete(rec);
      return c.json(200, { ok: true, deleted: "supplier", id });
    });
  } catch (err) {
    return c.json(400, { error: "Delete failed: " + String(err && err.message || err) });
  }
});

// ------------------------------------------------------------------ *
// Edit endpoints — allow correcting mistakes on financial records.
// ------------------------------------------------------------------ *

// --- update an expense (amount/desc/category/date) + its ledger txn ---
routerAdd("PATCH", "/api/dahav/records/expenses/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "expenses.edit")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  const body = c.requestInfo().body;
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("expenses", id);
      if (!rec) return c.json(404, { error: "Expense not found" });
      const engine = require(`${__hooks}/engine/index.cjs`);
      const services = require(`${__hooks}/lib/services.cjs`);
      const rate = Number(body.exchange_rate) || Number(rec.get("exchange_rate")) || services.defaultRate(txApp);
      const currency = body.currency || rec.get("currency") || "USD";
      const amount = body.amount !== undefined ? Number(body.amount) : Number(rec.get("amount"));
      const amountUsd = currency === "USD" ? engine.roundMoney(amount) : engine.roundMoney(amount / rate);
      if (body.description !== undefined) rec.set("description", body.description);
      if (body.category !== undefined) rec.set("category", body.category);
      if (body.supplier !== undefined) rec.set("supplier", body.supplier);
      if (body.payment_method !== undefined) rec.set("payment_method", body.payment_method);
      if (body.expense_date !== undefined) rec.set("expense_date", body.expense_date);
      if (body.amount !== undefined || body.currency !== undefined || body.exchange_rate !== undefined) {
        rec.set("amount", amount);
        rec.set("currency", currency);
        rec.set("exchange_rate", rate);
        rec.set("amount_usd", amountUsd);
      }
      txApp.save(rec);
      // Keep the ledger transaction in sync
      const txnId = rec.get("transaction");
      if (txnId) {
        try {
          const txn = txApp.findRecordById("transactions", txnId);
          if (txn) {
            txn.set("original_amount", amount);
            txn.set("original_currency", currency);
            txn.set("exchange_rate", rate);
            txn.set("amount_usd", amountUsd);
            txn.set("notes", body.description !== undefined ? body.description : txn.get("notes"));
            txApp.save(txn);
          }
        } catch (err) { /* txn missing */ }
      }
      return c.json(200, { ok: true, expense: rec });
    });
  } catch (err) {
    return c.json(400, { error: "Update failed: " + String(err && err.message || err) });
  }
});

// --- update a payment amount (rare) + its ledger txn ---
routerAdd("PATCH", "/api/dahav/records/payments/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "payments.edit")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  const body = c.requestInfo().body;
  try {
    return dh.deleteInTxn($app, (txApp) => {
      const rec = txApp.findRecordById("payments", id);
      if (!rec) return c.json(404, { error: "Payment not found" });
      const engine = require(`${__hooks}/engine/index.cjs`);
      if (body.amount !== undefined) {
        const amount = Number(body.amount);
        const currency = body.currency || rec.get("currency") || "USD";
        const rate = Number(body.exchange_rate) || Number(rec.get("exchange_rate")) || 1;
        const amountUsd = currency === "USD" ? engine.roundMoney(amount) : engine.roundMoney(amount / rate);
        rec.set("amount", amount);
        rec.set("currency", currency);
        rec.set("exchange_rate", rate);
        rec.set("amount_usd", amountUsd);
        if (body.payment_method !== undefined) rec.set("payment_method", body.payment_method);
        txApp.save(rec);
        const txnId = rec.get("transaction");
        if (txnId) {
          try {
            const txn = txApp.findRecordById("transactions", txnId);
            if (txn) {
              txn.set("original_amount", amount);
              txn.set("original_currency", currency);
              txn.set("exchange_rate", rate);
              txn.set("amount_usd", amountUsd);
              txApp.save(txn);
            }
          } catch (err) {}
        }
      } else if (body.payment_method !== undefined) {
        rec.set("payment_method", body.payment_method);
        txApp.save(rec);
      }
      return c.json(200, { ok: true, payment: rec });
    });
  } catch (err) {
    return c.json(400, { error: "Update failed: " + String(err && err.message || err) });
  }
});

// --- update a product (name/price/cost) — stock stays in layers ---
routerAdd("PATCH", "/api/dahav/records/products/{id}", (c) => {
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const dh = require(`${__hooks}/lib/delete-helpers.cjs`);
  const u = c.auth;
  if (!u || !constants.can(u.get("role"), "products.edit")) {
    return c.json(403, { error: "Not authorized" });
  }
  const id = c.request.pathValue("id");
  const body = c.requestInfo().body;
  try {
    const prod = $app.findRecordById("products", id);
    if (!prod) return c.json(404, { error: "Product not found" });
    if (body.name !== undefined) prod.set("name", body.name);
    if (body.sku !== undefined) prod.set("sku", body.sku);
    if (body.category !== undefined) prod.set("category", body.category);
    if (body.unit_price !== undefined) prod.set("unit_price", Number(body.unit_price));
    if (body.active !== undefined) prod.set("active", !!body.active);
    if (body.low_stock_threshold !== undefined) prod.set("low_stock_threshold", Number(body.low_stock_threshold) || 0);
    $app.save(prod);
    return c.json(200, { ok: true, product: prod });
  } catch (err) {
    return c.json(400, { error: "Update failed: " + String(err && err.message || err) });
  }
});

// --- audit: track creates on important records ---
onRecordAfterCreateSuccess((e) => {
  const tracked = ["transactions", "payments", "sales", "expenses", "payroll", "damage_records", "receipts", "inventory_movements", "invoices", "sale_items"];
  if (!e || !e.collection || !tracked.includes(e.collection.name)) {
    return;
  }
  const services = require(`${__hooks}/lib/services.cjs`);
  const user = $app.authStore().model;
  let snapshot = {};
  try {
    snapshot = e.record;
  } catch (err) {
    snapshot = {};
  }
  services.audit($app, {
    collection: e.collection.name,
    record_id: e.record.id,
    action: "create",
    after: snapshot,
    by: (user && user.id) || "",
  });
});

console.log("DAHAV hooks loaded ✔");
