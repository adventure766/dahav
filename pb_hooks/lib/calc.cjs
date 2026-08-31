/**
 * DAHAV Central Calculation Execution — server-side.
 *
 * Every financial write is funneled through the Calculation Engine
 * (pb_hooks/engine/index.cjs) and the resulting authoritative values are
 * persisted. No component independently recomputes money.
 *
 * All record creation uses: new Record(collection) then .set().
 */

const engine = require("../engine/index.cjs");
const services = require("./services.cjs");

/* ------------------------------------------------------------------ *
 * FIFO inventory layers
 * ------------------------------------------------------------------ */

/**
 * Find a product's FIFO layers ordered oldest-first (only layers with
 * remaining quantity > 0). Returns array of { id, remaining_quantity, unit_cost }.
 */
function fifoLayers(app, productId) {
  const layers = app.findRecordsByFilter("inventory_layers", `product = '${productId}' && remaining_quantity > 0`, "created", 100000, 0);
  const out = [];
  for (const l of layers) {
    out.push({ id: l.id, remaining_quantity: Number(l.get("remaining_quantity")) || 0, unit_cost: Number(l.get("unit_cost")) || 0 });
  }
  return out;
}

/**
 * Consume `qty` units from FIFO layers, oldest first.
 * Returns { costs: [{ quantity, unit_cost }], total_cost, entries: [{layer_id, quantity, unit_cost}] }
 * The total_cost is the authoritative FIFO COGS for those units.
 */
function consumeFifoLayers(app, productId, qty) {
  let remaining = qty;
  const costs = [];
  const entries = [];
  let totalCost = 0;
  const layers = fifoLayers(app, productId);
  for (const layer of layers) {
    if (remaining <= 0) break;
    const take = Math.min(layer.remaining_quantity, remaining);
    const cost = engine.roundMoney(take * layer.unit_cost);
    costs.push({ quantity: take, unit_cost: layer.unit_cost });
    entries.push({ layer_id: layer.id, quantity: take, unit_cost: layer.unit_cost });
    totalCost = engine.roundMoney(totalCost + cost);
    remaining -= take;
    // Reduce the layer
    const rec = app.findRecordById("inventory_layers", layer.id);
    rec.set("remaining_quantity", layer.remaining_quantity - take);
    app.save(rec);
  }
  if (remaining > 0) {
    throw new Error(`Insufficient FIFO inventory layers for product (short ${remaining} units)`);
  }
  return { costs, total_cost: totalCost, entries };
}

/**
 * Add a FIFO layer for a stock-in (purchase).
 */
function addFifoLayer(app, { product_id, quantity, unit_cost, reference, notes, by }) {
  const col = app.findCollectionByNameOrId("inventory_layers");
  const rec = new Record(col);
  rec.set("product", product_id);
  rec.set("quantity", quantity);
  rec.set("remaining_quantity", quantity);
  rec.set("unit_cost", engine.roundMoney(Number(unit_cost) || 0));
  rec.set("reference", reference || "");
  rec.set("notes", notes || "");
  rec.set("by", by || "");
  app.save(rec);
  return rec;
}

/**
 * Recompute a product's unit_cost as the weighted average of its remaining
 * FIFO layers. Keeps the products.unit_cost column meaningful for display and
 * legacy reads, while COGS itself always comes from the consumed layers.
 *
 * IMPORTANT: re-reads the product fresh so it never clobbers other fields
 * (e.g. stock) that may have changed on a stale in-memory instance.
 */
function refreshProductUnitCost(app, product) {
  const layers = app.findRecordsByFilter("inventory_layers", `product = '${product.id}' && remaining_quantity > 0`, "created", 100000, 0);
  let totalQty = 0;
  let totalValue = 0;
  for (const l of layers) {
    const q = Number(l.get("remaining_quantity")) || 0;
    totalQty += q;
    totalValue += q * (Number(l.get("unit_cost")) || 0);
  }
  const newCost = totalQty > 0 ? engine.roundMoney(totalValue / totalQty) : 0;
  // Re-read the product record so we only touch unit_cost and never
  // overwrite concurrent changes to stock or other fields.
  const fresh = app.findRecordById("products", product.id);
  // When no layers remain, keep the last known unit cost (never write 0,
  // which would blank the required field and lose the historical cost).
  fresh.set("unit_cost", newCost > 0 ? newCost : (Number(fresh.get("unit_cost")) || 0));
  app.save(fresh);
  return newCost;
}

/** Create the central ledger transaction record. */
function createLedger(app, { type, date, by, original_amount, original_currency, exchange_rate, reference, related_collection, related_id, notes, status }) {
  const dateKey = date ? new Date(date).toISOString().slice(0, 10).replace(/-/g, "") : undefined;
  const txn = services.nextId(app, "TR", dateKey);
  const snapshot = engine.buildTransactionSnapshot({
    type,
    original_amount,
    original_currency,
    exchange_rate,
    date: date ? new Date(date).toISOString() : new Date().toISOString(),
    user: by,
  });
  const col = app.findCollectionByNameOrId("transactions");
  const rec = new Record(col);
  rec.set("transaction_id", txn);
  rec.set("type", type);
  rec.set("date", snapshot.date);
  rec.set("by", by || "");
  rec.set("original_amount", snapshot.original_amount);
  rec.set("original_currency", snapshot.original_currency);
  rec.set("exchange_rate", snapshot.exchange_rate);
  rec.set("amount_usd", snapshot.amount_usd);
  rec.set("reference", reference || "");
  rec.set("related_collection", related_collection || "");
  rec.set("related_id", related_id || "");
  rec.set("notes", notes || "");
  rec.set("status", status || "completed");
  app.save(rec);
  return rec;
}

/** Record a stock movement and update the product's running stock. */
function applyStockMovement(app, { product, movement_type, quantity, unit_cost, reference, notes, by }) {
  const productRec = app.findRecordById("products", product);
  if (!productRec) throw new Error("Product not found");
  const currentStock = Number(productRec.get("stock")) || 0;
  const newStock = currentStock + quantity;
  if (newStock < 0) throw new Error(`Insufficient stock for ${productRec.get("name")}: have ${currentStock}, need ${-quantity}`);
  productRec.set("stock", newStock);
  app.save(productRec);
  const col = app.findCollectionByNameOrId("inventory_movements");
  const rec = new Record(col);
  rec.set("product", product);
  rec.set("movement_type", movement_type);
  rec.set("quantity", quantity);
  rec.set("unit_cost", unit_cost || productRec.get("unit_cost"));
  rec.set("stock_after", newStock);
  rec.set("reference", reference || "");
  rec.set("notes", notes || "");
  rec.set("by", by || "");
  app.save(rec);
  return rec;
}

/**
 * Execute a POS checkout within a transaction.
 */
function executePosCheckout(app, input) {
  const rate = Number(input.exchange_rate) || services.defaultRate(app);
  const date = input.date ? new Date(input.date) : new Date();
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");

  // Resolve products and validate stock
  const items = [];
  for (const it of input.items || []) {
    const p = app.findRecordById("products", it.product_id);
    if (!p) throw new Error("Product not found");
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) throw new Error("Quantity must be positive");
    if (Number(p.get("stock")) < qty) {
      throw new Error(`Insufficient stock for ${p.get("name")}`);
    }
    items.push({
      product: p,
      quantity: qty,
      unit_price: Number(p.get("unit_price")) || 0,
      unit_cost: Number(p.get("unit_cost")) || 0,
    });
  }
  if (items.length === 0) throw new Error("Cart is empty");

  // Central calculation
  const lines = items.map((i) => ({ unit_price: i.unit_price, quantity: i.quantity }));
  const totals = engine.cartTotals(lines);
  let discount = 0;
  if (Number(input.discount) > 0) {
    discount = input.discount_type === "percent"
      ? engine.percentDiscount(totals.total, Number(input.discount))
      : engine.absoluteDiscount(totals.total, Number(input.discount));
  }
  const totalUsd = engine.roundMoney(totals.total - discount);
  const pay = engine.paymentTotals({
    total_usd: totalUsd,
    payment_currency: input.payment_currency,
    rate,
    tendered: input.tendered || 0,
  });

  // ------------------------------------------------------------------
  // AMOUNT DUE vs AMOUNT ACTUALLY PAID (authoritative derivation)
  //
  // `pay.amount_due` is what the customer needed to pay (in payment
  // currency). `paidAmountDue` is what the system actually received and
  // applies to the sale. They are NOT the same thing — a customer who
  // tenders less than the due amount has only paid what they tendered.
  //
  // The derivation lives in engine.actualPaidAmount so the tests and every
  // consumer share one implementation.
  // ------------------------------------------------------------------
  const paid = engine.actualPaidAmount({
    amount_due: pay.amount_due,
    tendered: input.tendered,
    paid_amount: input.paid_amount,
  });
  const paidAmountDue = paid.paid;
  const paidTendered = paid.tendered;
  const paidChange = paid.change;
  const paidUsd = engine.toUsd(paidAmountDue, pay.payment_currency, rate);

  // Payment applied to this sale (full/partial/credit)
  const outstanding = engine.roundMoney(totalUsd - paidUsd);

  // Build records
  const saleId = services.nextId(app, "SALE", dateKey);
  const invoiceId = services.nextId(app, "INV", dateKey);

  const txn = createLedger(app, {
    type: "sale",
    date: date.toISOString(),
    by: input.cashier_id,
    original_amount: totalUsd,
    original_currency: "USD",
    exchange_rate: rate,
    reference: saleId,
    related_collection: "sales",
    notes: input.notes || "",
  });

  const saleCol = app.findCollectionByNameOrId("sales");
  const sale = new Record(saleCol);
  sale.set("sale_id", saleId);
  sale.set("date", date.toISOString());
  sale.set("transaction", txn.id);
  sale.set("customer", input.customer_id || "");
  sale.set("cashier", input.cashier_id || "");
  sale.set("subtotal", totals.subtotal);
  sale.set("discount", discount);
  sale.set("total", totalUsd);
  sale.set("status", outstanding > 0 ? "partial" : "completed");
  sale.set("amount_paid", paidUsd);
  sale.set("amount_outstanding", outstanding);
  sale.set("original_currency", "USD");
  sale.set("exchange_rate", rate);
  sale.set("amount_usd", totalUsd);
  sale.set("payment_method", input.payment_method || "");
  sale.set("notes", input.notes || "");
  app.save(sale);
  txn.set("related_id", sale.id);
  app.save(txn);

  // Sale items + stock movements (FIFO COGS from consumed inventory layers)
  for (const it of items) {
    // Consume FIFO layers for exactly `quantity` units; total_cost is authoritative COGS
    const fifo = consumeFifoLayers(app, it.product.id, it.quantity);
    const itemCol = app.findCollectionByNameOrId("sale_items");
    const item = new Record(itemCol);
    item.set("sale", sale.id);
    item.set("product", it.product.id);
    item.set("product_name", it.product.get("name"));
    item.set("quantity", it.quantity);
    item.set("unit_price", it.unit_price);
    item.set("unit_cost", fifo.total_cost / it.quantity); // average unit cost of consumed layers
    item.set("line_total", engine.lineTotal(it.unit_price, it.quantity));
    item.set("cogs", fifo.total_cost); // EXACT FIFO cost — never selling price
    item.set("fifo_breakdown", fifo.costs); // audit trail of layers consumed (JSON field)
    app.save(item);
    applyStockMovement(app, {
      product: it.product.id,
      movement_type: "sale",
      quantity: -it.quantity,
      unit_cost: fifo.total_cost / it.quantity,
      reference: saleId,
      by: input.cashier_id,
    });
    // Refresh weighted unit cost from remaining layers
    refreshProductUnitCost(app, it.product);
  }

  // Payment (only if any amount paid)
  let payment = null;
  let receipt = null;
  if (paidAmountDue > 0) {
    const paymentId = services.nextId(app, "PAY", dateKey);
    const payTxn = createLedger(app, {
      type: "payment",
      date: date.toISOString(),
      by: input.cashier_id,
      original_amount: paidAmountDue,
      original_currency: pay.payment_currency,
      exchange_rate: rate,
      reference: paymentId,
      related_collection: "payments",
      notes: `Payment for ${saleId}`,
    });
    const payCol = app.findCollectionByNameOrId("payments");
    payment = new Record(payCol);
    payment.set("payment_id", paymentId);
    payment.set("transaction", payTxn.id);
    payment.set("sale", sale.id);
    payment.set("customer", input.customer_id || "");
    payment.set("received_by", input.cashier_id || "");
    payment.set("amount", paidAmountDue);
    payment.set("currency", pay.payment_currency);
    payment.set("exchange_rate", rate);
    payment.set("amount_usd", paidUsd);
    payment.set("payment_method", input.payment_method || "cash");
    payment.set("tendered", paidTendered);
    payment.set("change", paidChange);
    // The payment record's own status mirrors the sale state: a payment that
    // does not settle the full balance is a partial payment.
    payment.set("status", outstanding > 0 ? "partial" : "paid");
    app.save(payment);
    payTxn.set("related_id", payment.id);
    app.save(payTxn);

    receipt = createReceipt(app, {
      sale,
      payment,
      payment_currency: pay.payment_currency,
      rate,
      amount_due: paidAmountDue,
      amount_usd: paidUsd,
      tendered: paidTendered,
      change: paidChange,
      items,
      totals: Object.assign({}, totals, { discount, total: totalUsd }),
      cashier_id: input.cashier_id,
      customer_id: input.customer_id || "",
      date,
    });
  }

  const invoice = new Record(app.findCollectionByNameOrId("invoices"));
  invoice.set("invoice_id", invoiceId);
  invoice.set("sale", sale.id);
  invoice.set("transaction", txn.id);
  invoice.set("customer", input.customer_id || "");
  invoice.set("total", totalUsd);
  invoice.set("amount_paid", paidUsd);
  invoice.set("amount_outstanding", outstanding);
  invoice.set("status", outstanding > 0 ? "partial" : "paid");
  app.save(invoice);

  // Audit trail
  try {
    services.audit(app, { collection: "sales", record_id: sale.id, action: "create", reason: "POS sale", after: { sale_id: saleId, total: totalUsd }, by: input.cashier_id });
    services.audit(app, { collection: "transactions", record_id: txn.id, action: "create", reason: "POS sale ledger", after: { transaction_id: txn.get("transaction_id") }, by: input.cashier_id });
    if (payment) {
      services.audit(app, { collection: "payments", record_id: payment.id, action: "create", reason: "POS payment", after: { payment_id: payment.get("payment_id"), amount: paidAmountDue, currency: pay.payment_currency }, by: input.cashier_id });
    }
  } catch (auditErr) {
    // audit must never break a sale
  }

  return { transaction: txn, sale, payment, receipt, invoice, items, totals: Object.assign({}, totals, { discount, total: totalUsd }), pay };
}

/** Build + persist a receipt snapshot. */
function createReceipt(app, { sale, payment, payment_currency, rate, amount_due, amount_usd, tendered, change, items, totals, cashier_id, customer_id, date }) {
  const settings = services.getSettings(app);
  const company = settings
    ? {
        company_name: settings.get("company_name") || "",
        address: settings.get("address") || "",
        phone: settings.get("phone") || "",
        email: settings.get("email") || "",
        tax_id: settings.get("tax_id") || "",
      }
    : {};
  const receiptId = services.nextId(app, "REC", date.toISOString().slice(0, 10).replace(/-/g, ""));

  let customerName = "";
  if (customer_id) {
    try {
      const c = app.findRecordById("customers", customer_id);
      customerName = c ? c.get("name") : "";
    } catch (e) { customerName = ""; }
  }
  let cashierName = "";
  if (cashier_id) {
    try {
      const u = app.findRecordById("users", cashier_id);
      cashierName = u ? u.get("name") : "";
    } catch (e) { cashierName = ""; }
  }

  // Resolve the ledger transaction ID for traceability on the receipt
  let transactionId = "";
  try {
    const txnId = sale ? sale.get("transaction") : "";
    if (txnId) {
      const txnRec = app.findRecordById("transactions", txnId);
      transactionId = txnRec ? txnRec.get("transaction_id") : "";
    }
  } catch (e) { transactionId = ""; }

  // The paid amount (in payment currency) and its USD equivalent.
  // For full payments these equal the sale total; for partial payments they
  // are the actual amount received.
  const paidDue = amount_due !== undefined && amount_due !== null ? engine.roundMoney(Number(amount_due)) : engine.roundMoney(totals.total);
  const paidUsdValue = amount_usd !== undefined && amount_usd !== null ? engine.roundMoney(Number(amount_usd)) : totals.total;

  // Authoritative payment state for THIS sale — including any prior payments.
  // The receipt must never claim a partial payment settled the whole balance.
  const state = sale ? engine.salePaymentState(sale) : { total: totals.total, paid: paidUsdValue, outstanding: Math.max(totals.total - paidUsdValue, 0), status: paidUsdValue >= totals.total ? "paid" : paidUsdValue > 0 ? "partial" : "unpaid" };
  const totalUsd = engine.roundMoney(state.total || totals.total);
  const outstanding = engine.roundMoney(Math.max(state.outstanding, 0));
  const status = state.status === "void" ? "void" : outstanding > 0 ? "partial" : "paid";
  // The full amount required in the payment currency (not the amount paid).
  const amountDue = engine.roundMoney(engine.fromUsd(totalUsd, payment_currency, rate));
  // ------------------------------------------------------------------
  // EXACT payment-currency views. The authoritative USD values are stored
  // in `outstanding` / `total_paid` for reports. But the RECEIPT is a
  // payment-currency document: it must show outstanding in the SAME
  // currency as due and paid. Outstanding in payment currency is computed
  // by in-currency subtraction:
  //
  //   outstanding_ccy = amount_due_ccy - total_paid_ccy
  //
  // where total_paid_ccy is the SUM of the actual payment amounts on the
  // sale, expressed in this receipt's currency (each converted at its own
  // exchange rate). This is exact for same-currency payments — e.g.
  // 393,600 SSP - 300,000 SSP = 93,600 SSP — and never loses precision by
  // round-tripping a 2-decimal USD value back to SSP.
  // ------------------------------------------------------------------
  let totalPaidCcy = 0;
  let totalPaidUsdFromPays = 0;
  try {
    if (sale) {
      const pays = app.findRecordsByFilter("payments", `sale = '${sale.id}'`, undefined, 0, 0);
      for (const p of pays) {
        if (p.get("status") === "void" || p.get("status") === "refunded") continue;
        const pAmount = Number(p.get("amount")) || 0;
        const pCcy = String(p.get("currency") || "USD").toUpperCase();
        const pRate = Number(p.get("exchange_rate")) || rate;
        if (pCcy === payment_currency) {
          totalPaidCcy = engine.roundMoney(totalPaidCcy + pAmount);
        } else {
          // Convert this payment into the receipt's currency via its USD value.
          totalPaidCcy = engine.roundMoney(totalPaidCcy + engine.fromUsd(Number(p.get("amount_usd")) || 0, payment_currency, pRate));
        }
        totalPaidUsdFromPays = engine.roundMoney(totalPaidUsdFromPays + (Number(p.get("amount_usd")) || 0));
      }
    }
  } catch (payErr) { /* payment list failure is non-fatal */ }
  if (totalPaidCcy <= 0) {
    // Fallback: derive from the authoritative USD value at this receipt's rate.
    totalPaidCcy = engine.roundMoney(engine.fromUsd(state.paid, payment_currency, rate));
  }
  const outstandingCcy = engine.roundMoney(Math.max(amountDue - totalPaidCcy, 0));

  const payload = {
    company,
    receipt_id: receiptId,
    transaction_id: transactionId,
    sale_id: sale ? sale.get("sale_id") : "",
    invoice_id: "",
    date: date ? date.toISOString() : new Date().toISOString(),
    cashier: cashierName,
    customer: customerName,
    items: items.map((i) => ({
      product_name: i.product.get("name"),
      quantity: i.quantity,
      unit_price: i.unit_price,
      line_total: engine.lineTotal(i.unit_price, i.quantity),
    })),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totalUsd,
    payment_currency,
    exchange_rate: rate,
    // AMOUNT DUE (what the customer needed to pay, in payment currency)
    amount_due: amountDue,
    // AMOUNT PAID (what was actually received, in payment currency)
    amount_paid: paidDue,
    tendered: tendered !== undefined ? engine.roundMoney(Number(tendered)) : paidDue,
    change: change !== undefined ? engine.roundMoney(Number(change)) : 0,
    // USD equivalent of the ACTUAL payment, never the sale total
    amount_usd: paidUsdValue,
    payment_method: payment ? payment.get("payment_method") : "",
    transaction_status: status,
    outstanding,
    total_paid: engine.roundMoney(state.paid),
    // Exact payment-currency views for receipts (see derivation above).
    total_paid_ccy: totalPaidCcy,
    outstanding_ccy: outstandingCcy,
  };

  const col = app.findCollectionByNameOrId("receipts");
  const rec = new Record(col);
  rec.set("receipt_id", receiptId);
  rec.set("transaction", sale ? sale.get("transaction") : "");
  rec.set("payment", payment ? payment.id : "");
  rec.set("sale", sale ? sale.id : "");
  rec.set("data", payload);
  app.save(rec);
  return rec;
}

/** Register an expense with its ledger transaction. */
function executeExpense(app, input) {
  const rate = Number(input.exchange_rate) || services.defaultRate(app);
  const date = input.expense_date ? new Date(input.expense_date) : new Date();
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");
  const amount = engine.roundMoney(Number(input.amount) || 0);
  const amountUsd = engine.toUsd(amount, input.currency, rate);
  const expenseId = services.nextId(app, "EXP", dateKey);

  const txn = createLedger(app, {
    type: "expense",
    date: date.toISOString(),
    by: input.created_by,
    original_amount: amount,
    original_currency: input.currency,
    exchange_rate: rate,
    reference: expenseId,
    related_collection: "expenses",
    notes: input.description || "",
  });

  const col = app.findCollectionByNameOrId("expenses");
  const rec = new Record(col);
  rec.set("expense_id", expenseId);
  rec.set("transaction", txn.id);
  rec.set("category", input.category || "");
  rec.set("supplier", input.supplier || "");
  rec.set("created_by", input.created_by || "");
  rec.set("description", input.description || "");
  rec.set("amount", amount);
  rec.set("currency", input.currency);
  rec.set("exchange_rate", rate);
  rec.set("amount_usd", amountUsd);
  rec.set("payment_method", input.payment_method || "cash");
  rec.set("status", "completed");
  rec.set("reference", input.reference || "");
  rec.set("expense_date", date.toISOString());
  app.save(rec);
  txn.set("related_id", rec.id);
  app.save(txn);

  services.audit(app, { collection: "expenses", record_id: rec.id, action: "create", reason: "expense recorded", after: { expense_id: expenseId, amount, currency: input.currency }, by: input.created_by });

  return { transaction: txn, expense: rec };
}

/**
 * Register a stock-in (purchase). Creates a FIFO inventory layer and
 * refreshes the product's weighted unit cost.
 * @param {object} app
 * @param {{product_id:string, quantity:number, unit_cost:number, by:string, reference?:string, notes?:string}} input
 */
function executeStockIn(app, input) {
  const product = app.findRecordById("products", input.product_id);
  if (!product) throw new Error("Product not found");
  const qty = Math.floor(Number(input.quantity) || 0);
  if (qty <= 0) throw new Error("Quantity must be positive");
  const unitCost = engine.roundMoney(Number(input.unit_cost) || 0);
  if (unitCost <= 0) throw new Error("Unit cost must be positive");

  const currentQty = Number(product.get("stock")) || 0;

  product.set("stock", currentQty + qty);
  app.save(product);

  const col = app.findCollectionByNameOrId("inventory_movements");
  const mov = new Record(col);
  mov.set("product", product.id);
  mov.set("movement_type", "purchase");
  mov.set("quantity", qty);
  mov.set("unit_cost", unitCost);
  mov.set("stock_after", currentQty + qty);
  mov.set("reference", input.reference || "");
  mov.set("notes", input.notes || "");
  mov.set("by", input.by || "");
  app.save(mov);

  // Create the FIFO layer
  const layer = addFifoLayer(app, {
    product_id: product.id,
    quantity: qty,
    unit_cost: unitCost,
    reference: mov.id,
    notes: input.notes || "",
    by: input.by,
  });

  // Refresh weighted unit cost from remaining layers
  refreshProductUnitCost(app, product);

  try {
    services.audit(app, { collection: "inventory_movements", record_id: mov.id, action: "create", reason: "stock in", after: { product: product.get("name"), quantity: qty, unit_cost: unitCost }, by: input.by });
  } catch (auditErr) {
    // audit must never break the stock operation
  }

  return { movement: mov, layer, product };
}

/**
 * Register damaged products. Damage cost = quantity x unit cost (cost basis).
 * @param {{product_id:string, quantity:number, by:string, reason?:string, notes?:string, damage_date?:string}} input
 */
function executeDamage(app, input) {
  const product = app.findRecordById("products", input.product_id);
  if (!product) throw new Error("Product not found");
  const qty = Math.floor(Number(input.quantity) || 0);
  if (qty <= 0) throw new Error("Quantity must be positive");
  const currentStock = Number(product.get("stock")) || 0;
  if (currentStock < qty) throw new Error(`Insufficient stock for ${product.get("name")}: have ${currentStock}, need ${qty}`);

  // Consume FIFO layers at their actual purchase cost — NEVER selling price.
  const fifo = consumeFifoLayers(app, product.id, qty);
  const totalCost = fifo.total_cost;
  const unitCost = engine.roundMoney(totalCost / qty);

  const date = input.damage_date ? new Date(input.damage_date) : new Date();
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");
  const damageId = services.nextId(app, "DMG", dateKey);

  // Ledger transaction (type=damage, loss at FIFO cost basis)
  const txn = createLedger(app, {
    type: "damage",
    date: date.toISOString(),
    by: input.by,
    original_amount: totalCost,
    original_currency: "USD",
    exchange_rate: services.defaultRate(app),
    reference: damageId,
    related_collection: "damage_records",
    notes: `Damaged ${qty} x ${product.get("name")} @ $${unitCost}`,
  });

  // Decrease stock + movement
  product.set("stock", currentStock - qty);
  app.save(product);
  const col = app.findCollectionByNameOrId("inventory_movements");
  const mov = new Record(col);
  mov.set("product", product.id);
  mov.set("movement_type", "damage");
  mov.set("quantity", -qty);
  mov.set("unit_cost", unitCost);
  mov.set("stock_after", currentStock - qty);
  mov.set("reference", damageId);
  mov.set("notes", input.notes || input.reason || "");
  mov.set("by", input.by || "");
  app.save(mov);

  // Refresh weighted unit cost from remaining layers
  refreshProductUnitCost(app, product);

  // Damage record
  const dmgCol = app.findCollectionByNameOrId("damage_records");
  const dmg = new Record(dmgCol);
  dmg.set("damage_id", damageId);
  dmg.set("transaction", txn.id);
  dmg.set("product", product.id);
  dmg.set("by", input.by || "");
  dmg.set("quantity", qty);
  dmg.set("unit_cost", unitCost);
  dmg.set("total_cost", totalCost);
  dmg.set("damage_date", date.toISOString());
  dmg.set("reason", input.reason || "");
  dmg.set("notes", input.notes || "");
  app.save(dmg);
  txn.set("related_id", dmg.id);
  app.save(txn);

  services.audit(app, { collection: "damage_records", record_id: dmg.id, action: "create", reason: "damage registered", after: { damage_id: damageId, quantity: qty, unit_cost: unitCost, total_cost: totalCost }, by: input.by });

  return { damage: dmg, movement: mov, transaction: txn, product, calculation: { quantity: qty, unit_cost: unitCost, total_cost: totalCost, method: "cost_basis" } };
}

/**
 * Register a payment against an existing sale (e.g. settling customer debt).
 * @param {object} app
 * @param {{sale_id:string, amount:number, currency:string, exchange_rate?:number, payment_method:string, tendered?:number, by:string, notes?:string, date?:string}} input
 */
function executePaymentOnSale(app, input) {
  const sale = app.findFirstRecordByFilter("sales", `sale_id = '${input.sale_id}'`);
  if (!sale) throw new Error("Sale not found");
  if (sale.get("voided")) throw new Error("Sale is voided");

  const rate = Number(input.exchange_rate) || services.defaultRate(app);
  const date = input.date ? new Date(input.date) : new Date();
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");

  const amount = engine.roundMoney(Number(input.amount) || 0);
  if (amount <= 0) throw new Error("Amount must be positive");
  const amountUsd = engine.toUsd(amount, input.currency, rate);

  const currentPaid = Number(sale.get("amount_paid")) || 0;
  const currentOutstanding = Number(sale.get("amount_outstanding")) || 0;
  const newPaid = engine.roundMoney(currentPaid + amountUsd);
  const newOutstanding = engine.roundMoney(currentOutstanding - amountUsd);
  if (newOutstanding < 0) throw new Error(`Payment exceeds outstanding balance (${currentOutstanding} USD)`);

  const paymentId = services.nextId(app, "PAY", dateKey);
  const payTxn = createLedger(app, {
    type: "payment",
    date: date.toISOString(),
    by: input.by,
    original_amount: amount,
    original_currency: input.currency,
    exchange_rate: rate,
    reference: paymentId,
    related_collection: "payments",
    notes: input.notes || `Payment against ${input.sale_id}`,
  });

  const payCol = app.findCollectionByNameOrId("payments");
  const payment = new Record(payCol);
  payment.set("payment_id", paymentId);
  payment.set("transaction", payTxn.id);
  payment.set("sale", sale.id);
  payment.set("customer", sale.get("customer") || "");
  payment.set("received_by", input.by || "");
  payment.set("amount", amount);
  payment.set("currency", input.currency);
  payment.set("exchange_rate", rate);
  payment.set("amount_usd", amountUsd);
  payment.set("payment_method", input.payment_method || "cash");
  payment.set("tendered", input.tendered || 0);
  payment.set("change", input.tendered ? engine.roundMoney(Math.max(0, (Number(input.tendered) || 0) - amount)) : 0);
  payment.set("status", "paid");
  payment.set("notes", input.notes || "");
  app.save(payment);
  payTxn.set("related_id", payment.id);
  app.save(payTxn);

  // Update sale balances (authoritative)
  sale.set("amount_paid", newPaid);
  sale.set("amount_outstanding", newOutstanding);
  sale.set("status", newOutstanding <= 0 ? "completed" : "partial");
  app.save(sale);

  // Keep the invoice in sync — it must never disagree with the sale.
  try {
    const inv = app.findFirstRecordByFilter("invoices", `sale = '${sale.id}'`);
    if (inv) {
      inv.set("amount_paid", newPaid);
      inv.set("amount_outstanding", newOutstanding);
      inv.set("status", newOutstanding <= 0 ? "paid" : "partial");
      app.save(inv);
    }
  } catch (invErr) { /* invoice missing is non-fatal */ }

  try {
    services.audit(app, { collection: "payments", record_id: payment.id, action: "create", reason: "payment on sale", after: { payment_id: paymentId, amount, currency: input.currency, amount_usd: amountUsd }, by: input.by });
  } catch (auditErr) { /* non-fatal */ }

  return { payment, transaction: payTxn, sale, amount_usd: amountUsd };
}

/**
 * Execute a payroll payment.
 * @param {object} app
 * @param {{employee_id:string, period:string, base_salary:number, allowances?:number, deductions?:number, currency:string, exchange_rate?:number, payment_method?:string, payment_date?:string, by:string, notes?:string}} input
 */
function executePayroll(app, input) {
  const employee = app.findRecordById("employees", input.employee_id);
  if (!employee) throw new Error("Employee not found");

  const rate = Number(input.exchange_rate) || services.defaultRate(app);
  const date = input.payment_date ? new Date(input.payment_date) : new Date();
  const dateKey = date.toISOString().slice(0, 10).replace(/-/g, "");

  const base = engine.roundMoney(Number(input.base_salary) || 0);
  const allowances = engine.roundMoney(Number(input.allowances) || 0);
  const deductions = engine.roundMoney(Number(input.deductions) || 0);
  const net = engine.netSalary(base, allowances, deductions);
  if (net <= 0) throw new Error("Net salary must be positive");
  const amountUsd = engine.toUsd(net, input.currency, rate);

  const payrollId = services.nextId(app, "PRL", dateKey);
  const txn = createLedger(app, {
    type: "salary",
    date: date.toISOString(),
    by: input.by,
    original_amount: net,
    original_currency: input.currency,
    exchange_rate: rate,
    reference: payrollId,
    related_collection: "payroll",
    notes: input.notes || `Salary ${input.period || ""} for ${employee.get("name")}`,
  });

  const col = app.findCollectionByNameOrId("payroll");
  const rec = new Record(col);
  rec.set("payroll_id", payrollId);
  rec.set("employee", employee.id);
  rec.set("transaction", txn.id);
  rec.set("paid_by", input.by || "");
  rec.set("period", input.period || "");
  rec.set("base_salary", base);
  rec.set("allowances", allowances);
  rec.set("deductions", deductions);
  rec.set("net_salary", net);
  rec.set("currency", input.currency);
  rec.set("exchange_rate", rate);
  rec.set("amount_usd", amountUsd);
  rec.set("status", "paid");
  rec.set("payment_date", date.toISOString());
  rec.set("payment_method", input.payment_method || "cash");
  rec.set("notes", input.notes || "");
  app.save(rec);
  txn.set("related_id", rec.id);
  app.save(txn);

  try {
    services.audit(app, { collection: "payroll", record_id: rec.id, action: "create", reason: "payroll payment", after: { payroll_id: payrollId, net, currency: input.currency, amount_usd: amountUsd }, by: input.by });
  } catch (auditErr) { /* non-fatal */ }

  return { payroll: rec, transaction: txn, calculation: { base, allowances, deductions, net, amount_usd: amountUsd, currency: input.currency, exchange_rate: rate } };
}

module.exports = {
  VERSION: 6,
  createLedger,
  applyStockMovement,
  executePosCheckout,
  createReceipt,
  executeExpense,
  executeStockIn,
  executeDamage,
  executePaymentOnSale,
  executePayroll,
};
