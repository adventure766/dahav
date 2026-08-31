/**
 * 020_create_payroll.js
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const employeesId = app.findCollectionByNameOrId("employees").id;

  app.save(new Collection({
    name: "payroll",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "payroll_id", type: "text", required: true, max: 60 },
      { name: "employee", type: "relation", collectionId: employeesId, maxSelect: 1 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "paid_by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "period", type: "text", max: 30 },
      { name: "base_salary", type: "number", required: true, min: 0 },
      { name: "allowances", type: "number", required: true, min: 0 },
      { name: "deductions", type: "number", required: true, min: 0 },
      { name: "net_salary", type: "number", required: true, min: 0 },
      { name: "currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "exchange_rate", type: "number", required: true, min: 0.0001 },
      { name: "amount_usd", type: "number", required: true, min: 0 },
      { name: "status", type: "select", required: true, values: ["paid", "unpaid", "void"], maxSelect: 1 },
      { name: "payment_date", type: "date" },
      { name: "payment_method", type: "text", max: 30 },
      { name: "notes", type: "text", max: 1000 },
      { name: "voided", type: "bool" },
      { name: "void_reason", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_payroll_payroll_id ON payroll (payroll_id)",
      "CREATE INDEX idx_payroll_employee ON payroll (employee)",
      "CREATE INDEX idx_payroll_transaction ON payroll (transaction)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("payroll"));
  } catch (e) { /* already deleted */ }
});
