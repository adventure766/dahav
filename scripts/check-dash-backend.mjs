const BASE = "http://localhost:8090";
(async () => {
  const login = await fetch(BASE + "/api/collections/users/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "owner@dahav.local", password: "owner12345" }),
  });
  const tok = (await login.json()).token;
  const H = { Authorization: tok };

  const dash = await (await fetch(BASE + "/api/dahav/dashboard?from=2026-08-01&to=2026-08-31", { headers: H })).json();
  console.log("DASHBOARD (Aug):", JSON.stringify({ revenue: dash.revenue, collected: dash.collected, gross: dash.gross_profit, net: dash.net_profit, cogs: dash.cogs, sales_count: dash.sales_count, low_stock: dash.low_stock.length, out_of_stock: dash.out_of_stock.length, methods: dash.payment_methods, currency_totals: dash.currency_totals, sales_status: dash.sales_status }));

  const perf = await (await fetch(BASE + "/api/dahav/dashboard/performance?from=2026-08-01&to=2026-08-31", { headers: H })).json();
  console.log("PERFORMANCE rows:", perf.rows.length, "first:", JSON.stringify(perf.rows[0]), "last:", JSON.stringify(perf.rows[perf.rows.length - 1]));

  const expCat = await (await fetch(BASE + "/api/dahav/dashboard/expenses-by-category?from=2026-08-01&to=2026-08-31", { headers: H })).json();
  console.log("EXPENSES BY CATEGORY:", JSON.stringify(expCat));

  const act = await (await fetch(BASE + "/api/dahav/dashboard/activity?limit=5", { headers: H })).json();
  console.log("ACTIVITY count:", act.rows.length, "first:", JSON.stringify(act.rows[0]));
})().catch((e) => console.error("ERR", e.message));
