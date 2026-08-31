const BASE = "http://localhost:8090";
(async () => {
  const login = await fetch(BASE + "/api/collections/users/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "owner@dahav.local", password: "owner12345" }),
  });
  const tok = (await login.json()).token;
  const H = { Authorization: tok };

  const dash = await (await fetch(BASE + "/api/dahav/dashboard", { headers: H })).json();
  console.log("DASHBOARD:", JSON.stringify({ revenue: dash.revenue, cogs: dash.cogs, gross_profit: dash.gross_profit, expenses: dash.expenses, damage_loss: dash.damage_loss, payroll: dash.payroll, net_profit: dash.net_profit }));

  const pnl = await (await fetch(BASE + "/api/dahav/reports/profit_loss", { headers: H })).json();
  console.log("P&L REPORT:", JSON.stringify(pnl));

  const salesR = await (await fetch(BASE + "/api/dahav/reports/sales", { headers: H })).json();
  console.log("SALES REPORT totals:", JSON.stringify(salesR.totals));
})().catch((e) => console.error("ERR", e.message));
