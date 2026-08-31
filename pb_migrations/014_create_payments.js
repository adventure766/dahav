/**
 * 014_create_payments.js
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const salesId = app.findCollectionByNameOrId("sales").id;
  const customersId = app.findCollectionByNameOrId("customers").id;

  app.save(new Collection({
    name: "payments",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "payment_id", type: "text", required: true, max: 60 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "sale", type: "relation", collectionId: salesId, maxSelect: 1 },
      { name: "customer", type: "relation", collectionId: customersId, maxSelect: 1 },
      { name: "received_by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "amount", type: "number", required: true, min: 0 },
      { name: "currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "exchange_rate", type: "number", required: true, min: 0.0001 },
      { name: "amount_usd", type: "number", required: true, min: 0 },
      { name: "payment_method", type: "select", required: true, values: ["cash", "card", "bank_transfer", "mobile_money", "credit", "other"], maxSelect: 1 },
      { name: "tendered", type: "number", min: 0 },
      { name: "change", type: "number", min: 0 },
      { name: "status", type: "select", required: true, values: ["paid", "partial", "pending", "void", "refunded"], maxSelect: 1 },
      { name: "notes", type: "text", max: 1000 },
      { name: "voided", type: "bool" },
      { name: "void_reason", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_payments_payment_id ON payments (payment_id)",
      "CREATE INDEX idx_payments_transaction ON payments (transaction)",
      "CREATE INDEX idx_payments_customer ON payments (customer)",
      "CREATE INDEX idx_payments_sale ON payments (sale)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("payments"));
  } catch (e) { /* already deleted */ }
});
