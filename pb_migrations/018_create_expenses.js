/**
 * 018_create_expenses.js
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const categoriesId = app.findCollectionByNameOrId("expense_categories").id;
  const suppliersId = app.findCollectionByNameOrId("suppliers").id;

  app.save(new Collection({
    name: "expenses",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "expense_id", type: "text", required: true, max: 60 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "category", type: "relation", collectionId: categoriesId, maxSelect: 1 },
      { name: "supplier", type: "relation", collectionId: suppliersId, maxSelect: 1 },
      { name: "created_by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "description", type: "text", max: 1000 },
      { name: "amount", type: "number", required: true, min: 0 },
      { name: "currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "exchange_rate", type: "number", required: true, min: 0.0001 },
      { name: "amount_usd", type: "number", required: true, min: 0 },
      { name: "payment_method", type: "select", required: true, values: ["cash", "card", "bank_transfer", "mobile_money", "credit", "other"], maxSelect: 1 },
      { name: "status", type: "text", max: 30 },
      { name: "reference", type: "text", max: 200 },
      { name: "expense_date", type: "date" },
      { name: "voided", type: "bool" },
      { name: "void_reason", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_expenses_expense_id ON expenses (expense_id)",
      "CREATE INDEX idx_expenses_transaction ON expenses (transaction)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("expenses"));
  } catch (e) { /* already deleted */ }
});
