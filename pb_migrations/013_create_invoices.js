/**
 * 013_create_invoices.js
 */
migrate((app) => {
  const salesId = app.findCollectionByNameOrId("sales").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const customersId = app.findCollectionByNameOrId("customers").id;

  app.save(new Collection({
    name: "invoices",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "invoice_id", type: "text", required: true, max: 60 },
      { name: "sale", type: "relation", collectionId: salesId, maxSelect: 1 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "customer", type: "relation", collectionId: customersId, maxSelect: 1 },
      { name: "total", type: "number", required: true, min: 0 },
      { name: "amount_paid", type: "number", required: true, min: 0 },
      { name: "amount_outstanding", type: "number", required: true, min: 0 },
      { name: "status", type: "text", max: 30 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_invoices_invoice_id ON invoices (invoice_id)",
      "CREATE INDEX idx_invoices_sale ON invoices (sale)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("invoices"));
  } catch (e) { /* already deleted */ }
});
