/**
 * DAHAV Reports — server-side aggregation from authoritative records.
 * Every total is derived from stored transaction values; no independent
 * recalculation. Reports never mix currencies.
 */

const engine = require("../engine/index.cjs");
const services = require("./services.cjs");

function dateRange(input) {
  const from = input && input.from ? new Date(input.from) : null;
  const to = input && input.to ? new Date(input.to) : null;
  return { from, to };
}

/** Parse a PocketBase date value safely (goja fails on "YYYY-MM-DD HH:mm" format). */
function parseDate(str) {
  if (!str) return null;
  if (str instanceof Date) {
    return Number.isNaN(str.getTime()) ? null : str;
  }
  const s = String(str).replace(" ", "T");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(dateStr, from, to) {
  const d = parseDate(dateStr);
  if (!d) return false;
  if (from && d < from) return false;
  if (to) {
    const end = parseDate(to);
    if (!end) return false;
    end.setHours(23, 59, 59, 999);
    if (d > end) return false;
  }
  return true;
}

function money(rec, field) {
  return Number(rec.get(field)) || 0;
}

/** Business date of a sale: explicit `date` field when set, else `created`. */
function saleDate(s) {
  return s.get("date") || s.get("created");
}

/** Sales report. */
function salesReport(app, input) {
  const { from, to } = dateRange(input);
  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0);
  const filtered = sales.filter((s) => !s.get("voided") && inRange(saleDate(s), from, to));

  const rows = filtered.map((s) => {
    const txn = s.get("transaction") ? (() => { try { return app.findRecordById("transactions", s.get("transaction")); } catch (e) { return null; } })() : null;
    let customerName = "";
    if (s.get("customer")) {
      try { const c = app.findRecordById("customers", s.get("customer")); customerName = c ? c.get("name") : ""; } catch (e) { customerName = ""; }
    }
    let cashierName = "";
    if (s.get("cashier")) {
      try { const u = app.findRecordById("users", s.get("cashier")); cashierName = u ? u.get("name") : ""; } catch (e) { cashierName = ""; }
    }
    // Per-payment details: each payment's ACTUAL recorded currency, amount,
    // exchange rate and USD equivalent. Never combined or re-converted — the
    // report shows exactly what was persisted at payment time so multi-payment
    // and multi-currency sales stay transparent.
    const payments = [];
    try {
      const pays = app.findRecordsByFilter("payments", `sale = '${s.id}'`, "created", 0, 0);
      for (const p of pays) {
        if (p.get("status") === "void" || p.get("status") === "refunded") continue;
        payments.push({
          payment_id: p.get("payment_id"),
          amount: Number(p.get("amount")) || 0,
          currency: String(p.get("currency") || "USD").toUpperCase(),
          exchange_rate: Number(p.get("exchange_rate")) || 0,
          amount_usd: Number(p.get("amount_usd")) || 0,
          payment_method: p.get("payment_method") || "",
          date: p.get("created"),
        });
      }
    } catch (e) { /* payment list failure is non-fatal */ }
    return {
      sale_id: s.get("sale_id"),
      transaction_id: txn ? txn.get("transaction_id") : "",
      customer_id: s.get("customer") || "",
      customer: customerName,
      cashier: cashierName,
      date: saleDate(s),
      total: money(s, "total"),
      subtotal: money(s, "subtotal"),
      discount: money(s, "discount"),
      amount_paid: money(s, "amount_paid"),
      amount_outstanding: money(s, "amount_outstanding"),
      // `paid`/`outstanding` are the keys the shared report model renders;
      // they always come from the authoritative persisted sale balance.
      paid: money(s, "amount_paid"),
      outstanding: money(s, "amount_outstanding"),
      status: s.get("status"),
      original_currency: s.get("original_currency"),
      exchange_rate: money(s, "exchange_rate"),
      // Payment currency/rate details for this sale (see payments above).
      payment_currency: payments.length ? payments.map((p) => p.currency).join("+") : (s.get("original_currency") || "USD"),
      payments,
    };
  });

  let total = 0, totalPaid = 0, totalOutstanding = 0, totalDiscount = 0, totalQty = 0;
  for (const r of rows) {
    total += r.total;
    totalPaid += r.amount_paid;
    totalOutstanding += r.amount_outstanding;
    totalDiscount += r.discount;
  }
  const items = app.findRecordsByFilter("sale_items", "", "", 100000, 0);
  for (const it of items) {
    const sale = it.get("sale");
    if (rows.some((r) => r.sale_id === (filtered.find((s) => s.id === sale) || {}).get && false)) { /* noop */ }
  }
  // quantity total
  for (const f of filtered) {
    for (const it of items) {
      if (it.get("sale") === f.id) totalQty += Number(it.get("quantity")) || 0;
    }
  }

  return {
    rows,
    totals: {
      total_sales: engine.roundMoney(total),
      total_discounts: engine.roundMoney(totalDiscount),
      total_paid: engine.roundMoney(totalPaid),
      total_outstanding: engine.roundMoney(totalOutstanding),
      total_quantity: totalQty,
      count: rows.length,
    },
  };
}

/** Payment report. */
function paymentReport(app, input) {
  const { from, to } = dateRange(input);
  const payments = app.findRecordsByFilter("payments", "", "-created", 100000, 0);
  const filtered = payments.filter((p) => !p.get("voided") && inRange(p.get("created"), from, to));

  const rows = filtered.map((p) => {
    const txn = p.get("transaction") ? (() => { try { return app.findRecordById("transactions", p.get("transaction")); } catch (e) { return null; } })() : null;
    let customerName = "";
    if (p.get("customer")) {
      try { const c = app.findRecordById("customers", p.get("customer")); customerName = c ? c.get("name") : ""; } catch (e) { customerName = ""; }
    }
    let cashierName = "";
    if (p.get("received_by")) {
      try { const u = app.findRecordById("users", p.get("received_by")); cashierName = u ? u.get("name") : ""; } catch (e) { cashierName = ""; }
    }
    return {
      payment_id: p.get("payment_id"),
      transaction_id: txn ? txn.get("transaction_id") : "",
      customer_id: p.get("customer") || "",
      customer: customerName,
      received_by: cashierName,
      date: p.get("created"),
      amount: money(p, "amount"),
      currency: p.get("currency"),
      exchange_rate: money(p, "exchange_rate"),
      amount_usd: money(p, "amount_usd"),
      payment_method: p.get("payment_method"),
      status: p.get("status"),
    };
  });

  let totalUsd = 0;
  let totalSsp = 0;
  let totalPaid = 0;
  for (const r of rows) {
    if (r.currency === "SSP") totalSsp += r.amount;
    totalUsd += r.amount_usd;
    if (r.status === "paid") totalPaid += r.amount_usd;
  }

  return {
    rows,
    totals: {
      total_usd: engine.roundMoney(totalUsd),
      total_ssp: Math.round(totalSsp),
      total_paid: engine.roundMoney(totalPaid),
      count: rows.length,
    },
  };
}

/** Expense report. */
function expenseReport(app, input) {
  const { from, to } = dateRange(input);
  const expenses = app.findRecordsByFilter("expenses", "", "-created", 100000, 0);
  const filtered = expenses.filter((e) => !e.get("voided") && inRange(e.get("expense_date") || e.get("created"), from, to));

  const rows = filtered.map((e) => {
    const txn = e.get("transaction") ? (() => { try { return app.findRecordById("transactions", e.get("transaction")); } catch (err) { return null; } })() : null;
    return {
      expense_id: e.get("expense_id"),
      transaction_id: txn ? txn.get("transaction_id") : "",
      date: e.get("expense_date") || e.get("created"),
      description: e.get("description"),
      amount: money(e, "amount"),
      currency: e.get("currency"),
      exchange_rate: money(e, "exchange_rate"),
      amount_usd: money(e, "amount_usd"),
      payment_method: e.get("payment_method"),
      category: e.get("category"),
    };
  });

  let totalUsd = 0, totalSsp = 0;
  for (const r of rows) {
    if (r.currency === "SSP") totalSsp += r.amount;
    totalUsd += r.amount_usd;
  }

  return {
    rows,
    totals: { total_usd: engine.roundMoney(totalUsd), total_ssp: Math.round(totalSsp), count: rows.length },
  };
}

/** Inventory report. */
function inventoryReport(app) {
  const products = app.findRecordsByFilter("products", "", "name", 100000, 0);
  const rows = products.map((p) => {
    const stock = Number(p.get("stock")) || 0;
    const unitCost = Number(p.get("unit_cost")) || 0;
    return {
      product_id: p.id,
      name: p.get("name"),
      sku: p.get("sku"),
      stock,
      unit_cost: unitCost,
      unit_price: Number(p.get("unit_price")) || 0,
      inventory_value: engine.roundMoney(stock * unitCost),
      low_stock_threshold: Number(p.get("low_stock_threshold")) || 0,
    };
  });

  let totalValue = 0;
  for (const r of rows) totalValue += r.inventory_value;

  return {
    rows,
    totals: {
      total_products: rows.length,
      total_units: rows.reduce((s, r) => s + r.stock, 0),
      total_value: engine.roundMoney(totalValue),
    },
  };
}

/** Damage report. */
function damageReport(app, input) {
  const { from, to } = dateRange(input);
  const damages = app.findRecordsByFilter("damage_records", "", "-created", 100000, 0);
  const filtered = damages.filter((d) => inRange(d.get("damage_date") || d.get("created"), from, to));

  const rows = filtered.map((d) => {
    const txn = d.get("transaction") ? (() => { try { return app.findRecordById("transactions", d.get("transaction")); } catch (e) { return null; } })() : null;
    return {
      damage_id: d.get("damage_id"),
      transaction_id: txn ? txn.get("transaction_id") : "",
      date: d.get("damage_date") || d.get("created"),
      product_id: d.get("product"),
      quantity: Number(d.get("quantity")) || 0,
      unit_cost: money(d, "unit_cost"),
      total_cost: money(d, "total_cost"),
      reason: d.get("reason"),
    };
  });

  let totalCost = 0, totalQty = 0;
  for (const r of rows) { totalCost += r.total_cost; totalQty += r.quantity; }

  return {
    rows,
    totals: { total_cost: engine.roundMoney(totalCost), total_quantity: totalQty, count: rows.length },
  };
}

/** Profit & Loss report. Supports USD (default) or SSP reporting currency. */
function profitLossReport(app, input) {
  const { from, to } = dateRange(input);
  const currency = (input && input.currency) ? String(input.currency).toUpperCase() : "USD";
  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0).filter((s) => !s.get("voided") && inRange(saleDate(s), from, to));
  const expenses = app.findRecordsByFilter("expenses", "", "-created", 100000, 0).filter((e) => !e.get("voided") && inRange(e.get("expense_date") || e.get("created"), from, to));
  const damages = app.findRecordsByFilter("damage_records", "", "-created", 100000, 0).filter((d) => inRange(d.get("damage_date") || d.get("created"), from, to));
  const payrolls = app.findRecordsByFilter("payroll", "", "-created", 100000, 0).filter((p) => p.get("status") === "paid" && inRange(p.get("payment_date") || p.get("created"), from, to));

  let revenue = 0, cogs = 0;
  for (const s of sales) revenue += money(s, "total");
  const items = app.findRecordsByFilter("sale_items", "", "", 100000, 0);
  for (const s of sales) {
    for (const it of items) {
      if (it.get("sale") === s.id) cogs += money(it, "cogs");
    }
  }

  let operatingExpenses = 0;
  for (const e of expenses) operatingExpenses += money(e, "amount_usd");
  for (const p of payrolls) operatingExpenses += money(p, "amount_usd");

  let otherLosses = 0;
  for (const d of damages) otherLosses += money(d, "total_cost");

  const gross = engine.grossProfit(revenue, cogs);
  const net = engine.netProfit(gross, operatingExpenses, otherLosses);

  // Reporting conversion: figures are USD; for an SSP view use the recorded default rate.
  const rate = services.defaultRate(app);
  const conv = (v) => (currency === "SSP" ? engine.fromUsd(v, "SSP", rate) : engine.roundMoney(v));

  return {
    revenue: conv(revenue),
    cogs: conv(cogs),
    gross_profit: conv(gross),
    operating_expenses: conv(operatingExpenses),
    other_losses: conv(otherLosses),
    net_profit: conv(net),
    sales_count: sales.length,
    expenses_count: expenses.length,
    damage_count: damages.length,
    payroll_count: payrolls.length,
    reporting_currency: currency,
    reporting_rate: rate,
    // Always include the USD truth for the "All" context.
    usd: {
      revenue: engine.roundMoney(revenue),
      cogs: engine.roundMoney(cogs),
      gross_profit: gross,
      operating_expenses: engine.roundMoney(operatingExpenses),
      other_losses: engine.roundMoney(otherLosses),
      net_profit: net,
    },
  };
}

/** Customer debt report. */
function customerDebtReport(app) {
  const customers = app.findRecordsByFilter("customers", "", "name", 100000, 0);
  const rows = customers.map((c) => {
    const sales = app.findRecordsByFilter("sales", `customer = '${c.id}'`, "", 100000, 0).filter((s) => !s.get("voided"));
    const payments = app.findRecordsByFilter("payments", `customer = '${c.id}'`, "", 100000, 0).filter((p) => !p.get("voided"));
    const balance = engine.customerBalance(
      sales.map((s) => ({ total_usd: money(s, "total"), amount_outstanding: money(s, "amount_outstanding"), status: s.get("voided") ? "void" : "completed" })),
      payments.map((p) => ({ amount_usd: money(p, "amount_usd"), status: p.get("status") || "paid" })),
    );
    return {
      customer_id: c.id,
      name: c.get("name"),
      phone: c.get("phone"),
      total_purchases: balance.total_purchases,
      total_paid: balance.total_paid,
      outstanding: balance.outstanding,
      credit: balance.credit,
    };
  }).filter((r) => r.outstanding > 0 || r.credit > 0);

  let totalOutstanding = 0, totalCredit = 0;
  for (const r of rows) { totalOutstanding += r.outstanding; totalCredit += r.credit; }

  return {
    rows,
    totals: {
      total_outstanding: engine.roundMoney(totalOutstanding),
      total_credit: engine.roundMoney(totalCredit),
      customers_with_debt: rows.length,
    },
  };
}

/** Payroll report. */
function payrollReport(app, input) {
  const { from, to } = dateRange(input);
  const payrolls = app.findRecordsByFilter("payroll", "", "-created", 100000, 0)
    .filter((p) => inRange(p.get("payment_date") || p.get("created"), from, to));

  const rows = payrolls.map((p) => {
    const txn = p.get("transaction") ? (() => { try { return app.findRecordById("transactions", p.get("transaction")); } catch (e) { return null; } })() : null;
    let employeeName = "";
    try {
      const emp = p.get("employee") ? app.findRecordById("employees", p.get("employee")) : null;
      employeeName = emp ? emp.get("name") : "";
    } catch (e) { employeeName = ""; }
    return {
      payroll_id: p.get("payroll_id"),
      transaction_id: txn ? txn.get("transaction_id") : "",
      employee: employeeName,
      period: p.get("period"),
      base_salary: money(p, "base_salary"),
      allowances: money(p, "allowances"),
      deductions: money(p, "deductions"),
      net_salary: money(p, "net_salary"),
      currency: p.get("currency"),
      exchange_rate: money(p, "exchange_rate"),
      amount_usd: money(p, "amount_usd"),
      status: p.get("status"),
      date: p.get("payment_date") || p.get("created"),
    };
  });

  let totalUsd = 0, totalSsp = 0;
  for (const r of rows) {
    if (r.currency === "SSP") totalSsp += r.net_salary;
    totalUsd += r.amount_usd;
  }

  return {
    rows,
    totals: { total_usd: engine.roundMoney(totalUsd), total_ssp: Math.round(totalSsp), count: rows.length },
  };
}

/**
 * Dashboard summary — assembled from authoritative stored records.
 * Every number is derived from persisted transactions; nothing is
 * independently recomputed in the frontend.
 */
function dashboardSummary(app, input) {
  const { from, to } = dateRange(input);
  // Period metrics: filtered by business date.
  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0).filter((s) => !s.get("voided") && inRange(saleDate(s), from, to));
  const payments = app.findRecordsByFilter("payments", "", "-created", 100000, 0).filter((p) => !p.get("voided") && inRange(p.get("created"), from, to));
  const expenses = app.findRecordsByFilter("expenses", "", "-created", 100000, 0).filter((e) => !e.get("voided") && inRange(e.get("expense_date") || e.get("created"), from, to));
  const damages = app.findRecordsByFilter("damage_records", "", "-created", 100000, 0).filter((d) => inRange(d.get("damage_date") || d.get("created"), from, to));
  const payrolls = app.findRecordsByFilter("payroll", "", "-created", 100000, 0).filter((p) => p.get("status") === "paid" && inRange(p.get("payment_date") || p.get("created"), from, to));
  // Point-in-time (current) metrics: inventory is a snapshot, not period-scoped.
  const products = app.findRecordsByFilter("products", "", "name", 100000, 0);

  let revenue = 0, collected = 0, outstanding = 0, expenseTotal = 0, damageTotal = 0, cogs = 0;
  let totalSspReceived = 0, totalSspSpent = 0;
  for (const s of sales) {
    revenue += money(s, "total");
    outstanding += money(s, "amount_outstanding");
  }
  for (const p of payments) {
    collected += money(p, "amount_usd");
    if (p.get("currency") === "SSP") totalSspReceived += money(p, "amount");
  }
  for (const e of expenses) {
    expenseTotal += money(e, "amount_usd");
    if (e.get("currency") === "SSP") totalSspSpent += money(e, "amount");
  }
  for (const d of damages) damageTotal += money(d, "total_cost");

  const items = app.findRecordsByFilter("sale_items", "", "", 100000, 0);
  for (const s of sales) {
    for (const it of items) {
      if (it.get("sale") === s.id) cogs += money(it, "cogs");
    }
  }

  let inventoryValue = 0, inventoryUnits = 0, damagedUnits = 0;
  let lowStock = [], outOfStock = [];
  for (const p of products) {
    const stock = Number(p.get("stock")) || 0;
    const threshold = Number(p.get("low_stock_threshold")) || 0;
    inventoryUnits += stock;
    inventoryValue += stock * (Number(p.get("unit_cost")) || 0);
    if (stock <= 0) {
      outOfStock.push({ product_id: p.id, name: p.get("name"), sku: p.get("sku"), stock });
    } else if (threshold > 0 && stock <= threshold) {
      lowStock.push({ product_id: p.id, name: p.get("name"), sku: p.get("sku"), stock, low_stock_threshold: threshold });
    }
  }
  for (const d of damages) damagedUnits += Number(d.get("quantity")) || 0;

  let payrollTotal = 0;
  for (const p of payrolls) payrollTotal += money(p, "amount_usd");

  // Payment method + currency breakdowns (period-scoped)
  const methodBreakdown = {};
  for (const p of payments) {
    const m = p.get("payment_method") || "other";
    methodBreakdown[m] = methodBreakdown[m] || { method: m, amount_usd: 0, count: 0 };
    methodBreakdown[m].amount_usd += money(p, "amount_usd");
    methodBreakdown[m].count += 1;
  }
  const payment_methods = Object.values(methodBreakdown).map((x) => ({ ...x, amount_usd: engine.roundMoney(x.amount_usd) }));

  // Sales status breakdown
  const salesStatus = {};
  for (const s of sales) {
    const st = s.get("status") || "completed";
    salesStatus[st] = (salesStatus[st] || 0) + 1;
  }

  const gross = engine.grossProfit(revenue, cogs);
  const operating = engine.roundMoney(expenseTotal + payrollTotal);
  const net = engine.netProfit(gross, operating, damageTotal);

  return {
    period: { from: from ? from.toISOString().slice(0, 10) : null, to: to ? to.toISOString().slice(0, 10) : null },
    revenue: engine.roundMoney(revenue),
    collected: engine.roundMoney(collected),
    outstanding: engine.roundMoney(outstanding),
    expenses: engine.roundMoney(expenseTotal),
    cogs: engine.roundMoney(cogs),
    gross_profit: gross,
    net_profit: net,
    damage_loss: engine.roundMoney(damageTotal),
    payroll: engine.roundMoney(payrollTotal),
    inventory_value: engine.roundMoney(inventoryValue),
    inventory_units: inventoryUnits,
    damaged_units: damagedUnits,
    sales_count: sales.length,
    payment_count: payments.length,
    expense_count: expenses.length,
    damage_count: damages.length,
    product_count: products.length,
    currency: services.mainCurrency(app),
    default_rate: services.defaultRate(app),
    currency_totals: {
      received_ssp: Math.round(totalSspReceived),
      received_usd: engine.roundMoney(collected),
      spent_ssp: Math.round(totalSspSpent),
      spent_usd: engine.roundMoney(expenseTotal),
    },
    sales_status: salesStatus,
    payment_methods: payment_methods.sort((a, b) => b.amount_usd - a.amount_usd),
    low_stock: lowStock,
    out_of_stock: outOfStock,
  };
}

/**
 * Revenue / COGS / gross profit bucketed over time for the dashboard chart.
 * Buckets by day for ranges up to 45 days, by week up to 180, by month otherwise.
 * An explicit `granularity` ("day" | "week" | "month") overrides the auto rule.
 */
function revenueOverTime(app, input) {
  const { from, to } = dateRange(input);
  const granularity = input && input.granularity ? String(input.granularity).toLowerCase() : "";
  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0).filter((s) => !s.get("voided") && inRange(saleDate(s), from, to));
  const items = app.findRecordsByFilter("sale_items", "", "", 100000, 0);
  const start = from ? from : new Date(Math.min(...sales.map((s) => parseDate(saleDate(s)).getTime())));
  const end = to ? to : new Date();

  const rangeDays = Math.max(1, Math.ceil((end - start) / 86400000));
  const g = granularity === "day" || granularity === "week" || granularity === "month" ? granularity : null;
  const bucketFn = g === "day"
    ? (d) => d.toISOString().slice(0, 10)
    : g === "week"
      ? (d) => { const c = new Date(d); const day = c.getDay(); c.setDate(c.getDate() - (day === 0 ? 6 : day - 1)); return c.toISOString().slice(0, 10); }
      : g === "month"
        ? (d) => d.toISOString().slice(0, 7)
        : rangeDays <= 45
          ? (d) => d.toISOString().slice(0, 10)
          : rangeDays <= 180
            ? (d) => { const c = new Date(d); const day = c.getDay(); c.setDate(c.getDate() - day); return c.toISOString().slice(0, 10); }
            : (d) => d.toISOString().slice(0, 7);

  const buckets = {};
  for (const s of sales) {
    const label = bucketFn(parseDate(saleDate(s)));
    buckets[label] = buckets[label] || { label, revenue: 0, cogs: 0, gross_profit: 0, sales_count: 0 };
    buckets[label].revenue += money(s, "total");
    buckets[label].sales_count += 1;
  }
  for (const s of sales) {
    const label = bucketFn(parseDate(saleDate(s)));
    for (const it of items) {
      if (it.get("sale") === s.id) buckets[label].cogs += money(it, "cogs");
    }
  }
  const rows = Object.values(buckets).map((b) => {
    b.revenue = engine.roundMoney(b.revenue);
    b.cogs = engine.roundMoney(b.cogs);
    b.gross_profit = engine.roundMoney(b.revenue - b.cogs);
    return b;
  }).sort((a, b) => a.label.localeCompare(b.label));
  return { rows, granularity: g || "auto" };
}

/** Expenses grouped by category name, with percentage of total. */
function expensesByCategory(app, input) {
  const { from, to } = dateRange(input);
  const expenses = app.findRecordsByFilter("expenses", "", "-created", 100000, 0).filter((e) => !e.get("voided") && inRange(e.get("expense_date") || e.get("created"), from, to));
  const cats = app.findRecordsByFilter("expense_categories", "", "name", 100000, 0);
  const catName = {};
  for (const c of cats) catName[c.id] = c.get("name");

  const groups = {};
  let total = 0;
  for (const e of expenses) {
    const cat = e.get("category");
    const name = (cat && catName[cat]) ? catName[cat] : "Uncategorized";
    groups[name] = (groups[name] || 0) + money(e, "amount_usd");
    total += money(e, "amount_usd");
  }
  const rows = Object.entries(groups).map(([category, amount_usd]) => ({
    category,
    amount_usd: engine.roundMoney(amount_usd),
    pct: total > 0 ? engine.roundMoney((amount_usd / total) * 100) : 0,
  })).sort((a, b) => b.amount_usd - a.amount_usd);
  return { rows, total: engine.roundMoney(total) };
}

/** Recent activity feed across financial events. */
function recentActivity(app, limit) {
  const max = Math.min(Number(limit) || 15, 50);
  const events = [];
  const userNames = {};
  try {
    const users = app.findRecordsByFilter("users", "", "name", 100000, 0);
    for (const u of users) userNames[u.id] = u.get("name");
  } catch (e) { /* users may be large; names are best-effort */ }

  const push = (type, ts, description, amount, transactionId, userId, link) => {
    events.push({ type, date: ts, description, amount: engine.roundMoney(Number(amount) || 0), transaction_id: transactionId, user: userNames[userId] || "", link });
  };

  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0).filter((s) => !s.get("voided"));
  for (const s of sales) {
    const txn = s.get("transaction") ? (() => { try { return app.findRecordById("transactions", s.get("transaction")); } catch (e) { return null; } })() : null;
    push("sale", saleDate(s), `Sale ${s.get("sale_id")}`, money(s, "total"), txn ? txn.get("transaction_id") : "", s.get("cashier"), { type: "sale", id: s.id });
  }
  const payments = app.findRecordsByFilter("payments", "", "-created", 100000, 0).filter((p) => !p.get("voided"));
  for (const p of payments) {
    const txn = p.get("transaction") ? (() => { try { return app.findRecordById("transactions", p.get("transaction")); } catch (e) { return null; } })() : null;
    push("payment", p.get("created"), `Payment ${p.get("payment_id")}`, money(p, "amount_usd"), txn ? txn.get("transaction_id") : "", p.get("received_by"), { type: "payment", id: p.id });
  }
  const expenses = app.findRecordsByFilter("expenses", "", "-created", 100000, 0).filter((e) => !e.get("voided"));
  for (const e of expenses) {
    const txn = e.get("transaction") ? (() => { try { return app.findRecordById("transactions", e.get("transaction")); } catch (err) { return null; } })() : null;
    push("expense", e.get("expense_date") || e.get("created"), `Expense ${e.get("expense_id")}${e.get("description") ? " — " + e.get("description") : ""}`, money(e, "amount_usd"), txn ? txn.get("transaction_id") : "", e.get("created_by"), { type: "expense", id: e.id });
  }
  const damages = app.findRecordsByFilter("damage_records", "", "-created", 100000, 0);
  for (const d of damages) {
    const txn = d.get("transaction") ? (() => { try { return app.findRecordById("transactions", d.get("transaction")); } catch (err) { return null; } })() : null;
    push("damage", d.get("damage_date") || d.get("created"), `Damage ${d.get("damage_id")}`, money(d, "total_cost"), txn ? txn.get("transaction_id") : "", d.get("by"), { type: "damage", id: d.id });
  }
  const payrolls = app.findRecordsByFilter("payroll", "", "-created", 100000, 0).filter((p) => p.get("status") === "paid");
  for (const p of payrolls) {
    const txn = p.get("transaction") ? (() => { try { return app.findRecordById("transactions", p.get("transaction")); } catch (err) { return null; } })() : null;
    push("payroll", p.get("payment_date") || p.get("created"), `Payroll ${p.get("payroll_id")}`, money(p, "amount_usd"), txn ? txn.get("transaction_id") : "", p.get("paid_by"), { type: "payroll", id: p.id });
  }

  events.sort((a, b) => {
    const da = parseDate(a.date);
    const db = parseDate(b.date);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  return { rows: events.slice(0, max) };
}

/**
 * Previous-period summary — the same dashboard metrics for the window
 * immediately preceding `[from, to]` of equal length. Lets the dashboard
 * show "vs previous period" deltas without recomputing money in the frontend.
 * Always compares like-for-like: same metrics, same engine, same code path
 * as `dashboardSummary`.
 */
function previousPeriodSummary(app, input) {
  const { from, to } = dateRange(input);
  const end = to ? new Date(to.getTime()) : new Date();
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from.getTime()) : new Date(end.getTime() - 29 * 86400000);
  const len = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const prevTo = new Date(start.getTime() - 86400000);
  prevTo.setHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo.getTime() - (len - 1) * 86400000);
  prevFrom.setHours(0, 0, 0, 0);

  const prev = dashboardSummary(app, { from: prevFrom, to: prevTo });
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
    revenue: prev.revenue,
    collected: prev.collected,
    outstanding: prev.outstanding,
    expenses: prev.expenses,
    cogs: prev.cogs,
    gross_profit: prev.gross_profit,
    net_profit: prev.net_profit,
    sales_count: prev.sales_count,
  };
}

/**
 * Recent transactions straight from the ledger, newest first.
 * Every money field comes from the persisted transaction snapshot;
 * customer/status are resolved best-effort from the related records.
 */
function recentTransactions(app, limit) {
  const max = Math.min(Number(limit) || 10, 50);
  const txns = app.findRecordsByFilter("transactions", "", "-created", max * 2, 0).filter((t) => !t.get("voided")).slice(0, max);

  const custName = {};
  try {
    const sales = app.findRecordsByFilter("sales", "", "", 100000, 0);
    const customers = app.findRecordsByFilter("customers", "", "", 100000, 0);
    const cMap = {};
    for (const c of customers) cMap[c.id] = c.get("name");
    for (const s of sales) custName[s.id] = cMap[s.get("customer")] || "Walk-in";
  } catch (e) { /* best-effort */ }

  const saleStatus = {};
  try {
    const sales = app.findRecordsByFilter("sales", "", "", 100000, 0);
    for (const s of sales) saleStatus[s.id] = s.get("status") || "completed";
  } catch (e) { /* best-effort */ }

  const rows = txns.map((t) => {
    const type = t.get("type") || "other";
    let status = t.get("status") || "completed";
    const related = t.get("related_collection");
    const relatedId = t.get("related_id");
    let customer = "";
    let link = null;
    if (related === "sales" && relatedId) {
      customer = custName[relatedId] || "Walk-in";
      link = { type: "sale", id: relatedId };
      if (saleStatus[relatedId]) status = saleStatus[relatedId];
    } else if (related === "payments" && relatedId) {
      link = { type: "payment", id: relatedId };
    }
    return {
      date: t.get("date") || t.get("created"),
      transaction_id: t.get("transaction_id"),
      type,
      description: t.get("reference") || type,
      customer,
      amount_usd: engine.roundMoney(money(t, "amount_usd")),
      original_amount: engine.roundMoney(money(t, "original_amount")),
      original_currency: t.get("original_currency") || "USD",
      exchange_rate: Number(t.get("exchange_rate")) || 0,
      status,
      link,
    };
  });
  return { rows };
}

/**
 * Top selling products by units sold, aggregated from sale_items joined
 * to non-voided sales within the period. Revenue and COGS are persisted USD.
 */
function topSellingProducts(app, input) {
  const { from, to } = dateRange(input);
  const limit = Math.min(Number((input && input.limit) || 5), 20);
  const sales = app.findRecordsByFilter("sales", "", "-created", 100000, 0).filter((s) => !s.get("voided") && inRange(saleDate(s), from, to));
  const saleIds = {};
  for (const s of sales) saleIds[s.id] = true;
  const items = app.findRecordsByFilter("sale_items", "", "", 100000, 0).filter((it) => saleIds[it.get("sale")]);

  const groups = {};
  for (const it of items) {
    const pid = it.get("product") || it.get("product_name") || "unknown";
    groups[pid] = groups[pid] || { product_id: it.get("product") || "", name: it.get("product_name") || "Unknown", units_sold: 0, revenue_usd: 0, cogs_usd: 0 };
    groups[pid].units_sold += Number(it.get("quantity")) || 0;
    groups[pid].revenue_usd += money(it, "line_total");
    groups[pid].cogs_usd += money(it, "cogs");
  }
  const rows = Object.values(groups).map((g) => ({
    ...g,
    units_sold: Math.round(g.units_sold),
    revenue_usd: engine.roundMoney(g.revenue_usd),
    cogs_usd: engine.roundMoney(g.cogs_usd),
  })).sort((a, b) => b.units_sold - a.units_sold).slice(0, limit);
  return { rows };
}

module.exports = {
  salesReport,
  paymentReport,
  expenseReport,
  inventoryReport,
  damageReport,
  profitLossReport,
  customerDebtReport,
  payrollReport,
  dashboardSummary,
  revenueOverTime,
  expensesByCategory,
  recentActivity,
  previousPeriodSummary,
  recentTransactions,
  topSellingProducts,
};
