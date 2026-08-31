/**
 * 011_create_sales.js
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const customersId = app.findCollectionByNameOrId("customers").id;

  app.save(new Collection({
    name: "sales",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "sale_id", type: "text", required: true, max: 60 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "customer", type: "relation", collectionId: customersId, maxSelect: 1 },
      { name: "cashier", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "subtotal", type: "number", required: true, min: 0 },
      { name: "discount", type: "number", min: 0 },
      { name: "total", type: "number", required: true, min: 0 },
      { name: "status", type: "select", required: true, values: ["completed", "partial", "credit", "void"], maxSelect: 1 },
      { name: "amount_paid", type: "number", min: 0 },
      { name: "amount_outstanding", type: "number", min: 0 },
      { name: "original_currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "exchange_rate", type: "number", required: true, min: 0.0001 },
      { name: "amount_usd", type: "number", required: true, min: 0 },
      { name: "payment_method", type: "text", max: 30 },
      { name: "notes", type: "text", max: 1000 },
      { name: "voided", type: "bool" },
      { name: "void_reason", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_sales_sale_id ON sales (sale_id)",
      "CREATE INDEX idx_sales_transaction ON sales (transaction)",
      "CREATE INDEX idx_sales_customer ON sales (customer)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("sales"));
  } catch (e) { /* already deleted */ }
});
