/**
 * 015_create_receipts.js
 */
migrate((app) => {
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const paymentsId = app.findCollectionByNameOrId("payments").id;
  const salesId = app.findCollectionByNameOrId("sales").id;

  app.save(new Collection({
    name: "receipts",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "receipt_id", type: "text", required: true, max: 60 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "payment", type: "relation", collectionId: paymentsId, maxSelect: 1 },
      { name: "sale", type: "relation", collectionId: salesId, maxSelect: 1 },
      { name: "data", type: "json" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_receipts_receipt_id ON receipts (receipt_id)",
      "CREATE INDEX idx_receipts_transaction ON receipts (transaction)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("receipts"));
  } catch (e) { /* already deleted */ }
});
