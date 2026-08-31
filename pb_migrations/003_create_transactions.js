/**
 * 003_create_transactions.js
 * The central transaction ledger — every financial event traces here.
 * Created early because sales/payments/expenses reference it.
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  app.save(new Collection({
    name: "transactions",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "",
    fields: [
      { name: "transaction_id", type: "text", required: true, max: 60 },
      { name: "type", type: "select", required: true, values: ["sale", "sale_refund", "payment", "payment_refund", "expense", "salary", "damage", "other_income", "other_outgoing", "inventory_adjustment"], maxSelect: 1 },
      { name: "date", type: "date" },
      { name: "by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "original_amount", type: "number", required: true },
      { name: "original_currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "exchange_rate", type: "number", required: true, min: 0.0001 },
      { name: "amount_usd", type: "number", required: true },
      { name: "reference", type: "text", max: 200 },
      { name: "related_collection", type: "text", max: 60 },
      { name: "related_id", type: "text", max: 120 },
      { name: "notes", type: "text", max: 1000 },
      { name: "status", type: "select", required: true, values: ["completed", "void", "pending"], maxSelect: 1 },
      { name: "voided", type: "bool" },
      { name: "void_reason", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_transactions_transaction_id ON transactions (transaction_id)",
      "CREATE INDEX idx_transactions_type ON transactions (type)",
      "CREATE INDEX idx_transactions_date ON transactions (date)",
      "CREATE INDEX idx_transactions_by ON transactions (by)",
      "CREATE INDEX idx_transactions_original_currency ON transactions (original_currency)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("transactions"));
  } catch (e) { /* already deleted */ }
});
