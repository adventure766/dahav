/**
 * 010_create_customers.js
 */
migrate((app) => {
  app.save(new Collection({
    name: "customers",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "name", type: "text", required: true, max: 200 },
      { name: "phone", type: "text", max: 40 },
      { name: "email", type: "text", max: 120 },
      { name: "address", type: "text", max: 300 },
      { name: "notes", type: "text", max: 1000 },
    ],
    indexes: ["CREATE INDEX idx_customers_name ON customers (name)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("customers"));
  } catch (e) { /* already deleted */ }
});
