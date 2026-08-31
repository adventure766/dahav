/**
 * End-to-end smoke test of the DAHAV API.
 * Idempotent: uses unique emails per run.
 */
const BASE = "http://127.0.0.1:8092";
const runId = Date.now();
const managerEmail = `anas-${runId}@dahav.local`;

async function main() {
  // 1. Superuser auth
  const su = await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin@dahav.local", password: "admin12345" }),
  });
  const suJson = await su.json();
  const suToken = suJson.token;
  console.log("superuser token:", suToken ? "OK" : "FAIL");
  if (!suToken) return;

  // 2. Create a manager user (role-based staff)
  const manager = await fetch(`${BASE}/api/collections/users/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: suToken },
    body: JSON.stringify({ email: managerEmail, password: "password123", passwordConfirm: "password123", name: "Anas", role: "manager" }),
  });
  const managerJson = await manager.json();
  console.log("create manager:", manager.status, managerJson.id || managerJson.message);
  if (manager.status !== 200) { console.log(JSON.stringify(managerJson)); return; }

  // 3. Manager auth
  const ma = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: managerEmail, password: "password123" }),
  });
  const maJson = await ma.json();
  const mgrToken = maJson.token;
  console.log("manager token:", mgrToken ? "OK" : "FAIL");
  if (!mgrToken) return;

  // 4. Create a product (milk $2.50, cost $1.80)
  const prod = await fetch(`${BASE}/api/collections/products/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: mgrToken },
    body: JSON.stringify({ name: `Milk-${runId}`, unit_price: 2.5, unit_cost: 1.8, stock: 100, currency: "USD", active: true }),
  });
  const prodJson = await prod.json();
  console.log("create product:", prod.status, prodJson.id || prodJson.message);
  if (prod.status !== 200) { console.log(JSON.stringify(prodJson)); return; }
  const productId = prodJson.id;

  // 5. POS checkout: 2x milk = $5.00, payment in SSP @ 8000, tendered 50,000 SSP
  const checkout = await fetch(`${BASE}/api/dahav/pos/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: mgrToken },
    body: JSON.stringify({
      items: [{ product_id: productId, quantity: 2 }],
      payment_method: "cash",
      payment_currency: "SSP",
      exchange_rate: 8000,
      tendered: 50000,
      customer_id: "",
    }),
  });
  const coJson = await checkout.json();
  console.log("checkout status:", checkout.status);
  if (checkout.status !== 200) {
    console.log("checkout error:", JSON.stringify(coJson));
    return;
  }
  console.log("SALE:", coJson.sale.sale_id, "total:", coJson.sale.total, "status:", coJson.sale.status);
  console.log("PAYMENT:", coJson.payment.payment_id, "amount:", coJson.payment.amount, coJson.payment.currency, "change:", coJson.payment.change);
  console.log("RECEIPT:", coJson.receipt.receipt_id, "txn:", coJson.transaction.transaction_id);
  console.log("INVOICE:", coJson.invoice.invoice_id);

  // Verify calculations match the required test vector
  const expected = {
    total: 5,            // $5.00
    amount_due: 40000,   // 40,000 SSP
    change: 10000,       // 10,000 SSP
    amount_usd: 5,       // $5.00
  };
  const actual = {
    total: coJson.sale.total,
    amount_due: coJson.payment.amount,
    change: coJson.payment.change,
    amount_usd: coJson.payment.amount_usd,
  };
  const pass = Object.keys(expected).every((k) => Math.abs(expected[k] - actual[k]) < 0.001);
  console.log("CALC VERIFICATION:", pass ? "PASS" : "FAIL", JSON.stringify({ expected, actual }));
}

main().catch((e) => console.error("FATAL", e));
