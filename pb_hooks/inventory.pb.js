// Stock-in + damage routes in their own file.
routerAdd("POST", "/api/dahav/inventory/stock-in", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "inventory.adjust")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  try {
    const input = Object.assign({}, body, { by: user.id });
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executeStockIn(txApp, input);
    });
    return c.json(200, result);
  } catch (err) {
    return c.json(400, { error: "stock-in failed", errmsg: String(err && err.message), steps: err && err.steps ? err.steps : [], version: calc.VERSION });
  }
});

routerAdd("POST", "/api/dahav/inventory/damage", (c) => {
  const calc = require(`${__hooks}/lib/calc.cjs`);
  const constants = require(`${__hooks}/lib/constants.cjs`);
  const user = c.auth;
  if (!user || !constants.can(user.get("role"), "inventory.damage")) {
    return c.json(403, { error: "Not authorized" });
  }
  const body = c.requestInfo().body;
  try {
    let result = null;
    $app.runInTransaction(function txWrapper(txApp) {
      result = calc.executeDamage(txApp, Object.assign({}, body, { by: user.id }));
    });
    return c.json(200, result);
  } catch (err) {
    const msg = (err && err.message) ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
    return c.json(400, { error: msg || "Damage registration failed" });
  }
});
