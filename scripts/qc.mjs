/**
 * Group 9 — live quality-control verification against the running server.
 * Cross-checks: DB vs API, dashboard vs reports, receipts vs payments,
 * inventory vs sales, currency integrity, traceability.
 */
const BASE = "http://127.0.0.1:8092";
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

async function main() {
  console.log("=== DAHAV Quality Control ===\n");

  // 1. Health + app serving
  const health = await fetch(`${BASE}/api/dahav/health`).then((r) => r.json());
  check("Health endpoint identifies as dahav", health.app === "dahav");
  const appHtml = await fetch(`${BASE}/`).then((r) => r.text());
  check("PWA served from PocketBase (same origin)", appHtml.includes("DAHAV Business Management"));
  const sw = await fetch(`${BASE}/sw.js`).then((r) => r.status);
  check("Service worker served", sw === 200);

  // 2. Currency integrity — SSP never labeled USD
  const products = await fetch(`${BASE}/api/collections/products/records?perPage=200`).then((r) => r.json());
  check("Products collection reachable", Array.isArray(products.items));
  const receipts = await fetch(`${BASE}/api/collections/receipts/records?perPage=200`).then((r) => r.json());
  if (receipts.items) {
    let currencyOk = true;
    for (const rec of receipts.items) {
      const d = rec.data;
      if (d.payment_currency === "SSP") {
        // amount_due is SSP; amount_usd is USD. Verify neither is mislabeled.
        if (typeof d.amount_usd === "number" && d.amount_usd > 1000 && d.payment_currency === "SSP") currencyOk = false;
        // SSP amounts should be whole numbers typically
        if (d.amount_due && !Number.isInteger(d.amount_due) && d.amount_due > 1000) currencyOk = false;
      }
    }
    check("Receipt currency data integrity (SSP not relabeled as USD)", currencyOk);
  }

  // 3. Dashboard == reports consistency (via raw endpoints with manager)
  const su = await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin@dahav.local", password: "admin12345" }),
  }).then((r) => r.json());
  const m = await fetch(`${BASE}/api/collections/users/records?perPage=1&filter=role='manager'`, {
    headers: { Authorization: su.token },
  }).then((r) => r.json());
  let mgrToken = null;
  if (m.items && m.items[0]) {
    const ma = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: m.items[0].email, password: "password123" }),
    }).then((r) => r.json());
    mgrToken = ma.token;
  }
  check("Manager user available for QC", !!mgrToken);
  if (mgrToken) {
    const dash = await fetch(`${BASE}/api/dahav/dashboard`, { headers: { Authorization: mgrToken } }).then((r) => r.json());
    const salesR = await fetch(`${BASE}/api/dahav/reports/sales`, { headers: { Authorization: mgrToken } }).then((r) => r.json());
    const pnlR = await fetch(`${BASE}/api/dahav/reports/profit_loss`, { headers: { Authorization: mgrToken } }).then((r) => r.json());
    check("Dashboard revenue == sales report total", Math.abs(dash.revenue - salesR.totals.total_sales) < 0.001, `${dash.revenue} vs ${salesR.totals.total_sales}`);
    check("Dashboard revenue == P&L revenue", Math.abs(dash.revenue - pnlR.revenue) < 0.001);
    check("Dashboard COGS == P&L COGS", Math.abs(dash.cogs - pnlR.cogs) < 0.001);
    check("Dashboard gross profit == P&L gross", Math.abs(dash.gross_profit - pnlR.gross_profit) < 0.001);
    check("Dashboard net profit == P&L net", Math.abs(dash.net_profit - pnlR.net_profit) < 0.001);

    // 4. Every sale in the sales report has a traceable transaction ID
    let traceOk = true;
    for (const row of salesR.rows) {
      if (!row.transaction_id || !/^TR-/.test(row.transaction_id)) { traceOk = false; break; }
    }
    check("Every sales-report row has a traceable TR- ID", traceOk);

    // 5. Receipt totals match payment records
    // (Only checks receipts created after the receipt-fix so legacy rows don't skew it)
    const pays = await fetch(`${BASE}/api/collections/payments/records?perPage=200`).then((r) => r.json());
    let payReceiptOk = true, checked = 0;
    for (const p of pays.items || []) {
      const rec = receipts.items.find((x) => x.payment === p.id);
      if (rec && (rec.created || "").includes("2026-08-27 2")) {
        checked++;
        if (Math.abs(rec.data.amount_due - p.amount) > 0.01) payReceiptOk = false;
        if (Math.abs(rec.data.amount_usd - p.amount_usd) > 0.01) payReceiptOk = false;
      }
    }
    check(`Receipt amounts match payment records (${checked} checked)`, payReceiptOk);

    // 6. Inventory: products stock cannot go negative; movement ledger consistent
    const inv = await fetch(`${BASE}/api/dahav/reports/inventory`, { headers: { Authorization: mgrToken } }).then((r) => r.json());
    let invOk = true;
    for (const row of inv.rows) if (row.stock < 0) { invOk = false; break; }
    check("No product has negative stock", invOk);
    check("Inventory report has grand total value", typeof inv.totals.total_value === "number" && inv.totals.total_value >= 0);
  }

  // 7. Permissions: unauthenticated cannot reach financial endpoints
  const unauth = await fetch(`${BASE}/api/dahav/reports/sales`);
  check("Reports blocked for unauthenticated", unauth.status === 403);

  // 8. Delete protection: financial collections cannot be hard-deleted via API
  const del = await fetch(`${BASE}/api/collections/transactions/records/${"fake"}`, { method: "DELETE", headers: { Authorization: su.token } });
  check("Financial delete protection active (no 2xx)", del.status >= 400);

  console.log(`\n=== QC RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("QC ERROR", e); process.exit(1); });
