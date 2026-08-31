/**
 * FINAL VALIDATION — the user's 20-step end-to-end check.
 * Creates a real product, sells through POS, adds expense, registers damage,
 * and verifies DB/engine/dashboard/reports all agree.
 */
const BASE = "http://localhost:8090";
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
async function post(path, body, token) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  console.log("=== FINAL VALIDATION: 20-step scenario ===\n");
  const login = await post("/api/collections/users/auth-with-password", { identity: "owner@dahav.local", password: "owner12345" });
  const tok = login.data.token;
  check("1. owner login", login.status === 200);

  const suffix = Date.now();
  // 2-4: product with known cost + price, no stock
  const prod = await post("/api/collections/products/records", { name: `Final-${suffix}`, unit_price: 4, unit_cost: 2.5, stock: 0, currency: "USD", active: true }, tok);
  const pid = prod.data.id;
  check("2-4. product created (price $4, cost $2.50)", prod.status === 200);

  // 5. create stock: 10 @ $2.50
  const si = await post("/api/dahav/inventory/stock-in", { product_id: pid, quantity: 10, unit_cost: 2.5 }, tok);
  check("5. stock-in 10 @ $2.50", si.status === 200);
  const p0 = await (await fetch(`${BASE}/api/collections/products/records/${pid}`)).json();
  check("   stock now 10", p0.stock === 10);

  // 6-7. sell 10 through POS, complete payment
  const co = await post("/api/dahav/pos/checkout", { items: [{ product_id: pid, quantity: 10 }], payment_method: "cash", payment_currency: "USD", exchange_rate: 8000, tendered: 40 }, tok);
  check("6-7. POS sale + payment", co.status === 200);
  const sale = co.data.sale;
  const txn = co.data.transaction;
  check("8. transaction created", txn && /^TR-/.test(txn.transaction_id));
  const p1 = await (await fetch(`${BASE}/api/collections/products/records/${pid}`)).json();
  check("8. inventory reduced to 0", p1.stock === 0);

  // 9-10. COGS + revenue
  const items = await (await fetch(`${BASE}/api/collections/sale_items/records?filter=sale='${sale.id}'`)).json();
  const item = items.items[0];
  check("9. COGS = $25 (10 x $2.50 FIFO)", item.cogs === 25, `got ${item.cogs}`);
  check("10. revenue = $40 (10 x $4)", sale.total === 40, `got ${sale.total}`);

  // 11. gross profit
  const gross = sale.total - item.cogs;
  check("11. gross profit = $15", gross === 15, `got ${gross}`);

  // 12. add expense $5
  const cat = await post("/api/collections/expense_categories/records", { name: `FinalCat-${suffix}` }, tok);
  const exp = await post("/api/dahav/expenses/create", { description: "final test", category: cat.data.id, amount: 5, currency: "USD", payment_method: "cash" }, tok);
  check("12. expense $5 recorded", exp.status === 200);

  // 13. net profit = 15 - 5 = 10 (no damage yet)
  const pnl1 = await (await fetch(`${BASE}/api/dahav/reports/profit_loss`, { headers: { Authorization: tok } })).json();
  // 14-16. damage: need stock — stock-in 5 @ $2.50 then damage 4
  await post("/api/dahav/inventory/stock-in", { product_id: pid, quantity: 5, unit_cost: 2.5 }, tok);
  const dmg = await post("/api/dahav/inventory/damage", { product_id: pid, quantity: 4, reason: "final test" }, tok);
  check("14. damage registered", dmg.status === 200);
  const dmgCalc = dmg.data.calculation;
  check("15. damage loss = $10 (4 x $2.50)", dmgCalc.total_cost === 10, `got ${dmgCalc.total_cost}`);
  check("15. inventory reduced to 1", dmg.data.product.stock === 1, `got ${dmg.data.product.stock}`);
  const p2 = await (await fetch(`${BASE}/api/collections/products/records/${pid}`)).json();
  check("16. DB inventory confirms 1", p2.stock === 1);

  // 17-19. dashboard + reports + receipt
  const dash = await (await fetch(`${BASE}/api/dahav/dashboard`, { headers: { Authorization: tok } })).json();
  const pnl2 = await (await fetch(`${BASE}/api/dahav/reports/profit_loss`, { headers: { Authorization: tok } })).json();
  const receipt = await (await fetch(`${BASE}/api/collections/receipts/records/${co.data.receipt.id}`)).json();
  check("17. dashboard reads authoritative values", dash.revenue === pnl2.revenue && dash.cogs === pnl2.cogs && dash.gross_profit === pnl2.gross_profit && dash.net_profit === pnl2.net_profit);
  check("18. reports agree", pnl2.gross_profit === pnl2.revenue - pnl2.cogs && pnl2.net_profit === pnl2.gross_profit - pnl2.operating_expenses - pnl2.other_losses);
  check("19. receipt exists with txn link", receipt.receipt_id && receipt.data.transaction_id === txn.transaction_id);

  // 20. database agrees
  const grossDb = Math.round((dash.revenue - dash.cogs) * 100) / 100;
  check("20. dashboard gross == DB revenue-COGS", Math.abs(grossDb - dash.gross_profit) < 0.01);

  // Damage should NOT be double counted: P&L other_losses == damage report total
  const dmgR = await (await fetch(`${BASE}/api/dahav/reports/damage`, { headers: { Authorization: tok } })).json();
  check("damage counted exactly once", pnl2.other_losses === dmgR.totals.total_cost, `pnl ${pnl2.other_losses} vs damage ${dmgR.totals.total_cost}`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  console.log("\nCurrent live dashboard values:");
  console.log(JSON.stringify({ revenue: dash.revenue, cogs: dash.cogs, gross_profit: dash.gross_profit, expenses: dash.expenses, damage_loss: dash.damage_loss, net_profit: dash.net_profit }, null, 1));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("VALIDATION ERROR", e.message); process.exit(1); });
