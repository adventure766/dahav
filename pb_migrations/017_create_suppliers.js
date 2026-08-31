/**
 * 017_create_suppliers.js
 */
migrate((app) => {
  app.save(new Collection({
    name: "suppliers",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "name", type: "text", required: true, max: 200 },
      { name: "phone", type: "text", max: 40 },
      { name: "email", type: "text", max: 120 },
      { name: "address", type: "text", max: 300 },
    ],
    indexes: ["CREATE INDEX idx_suppliers_name ON suppliers (name)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("suppliers"));
  } catch (e) { /* already deleted */ }
});
