/**
 * 019_create_employees.js
 */
migrate((app) => {
  app.save(new Collection({
    name: "employees",
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
      { name: "position", type: "text", max: 120 },
      { name: "status", type: "select", required: true, values: ["active", "inactive"], maxSelect: 1 },
      { name: "salary", type: "number", required: true, min: 0 },
      { name: "salary_currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "join_date", type: "date" },
      { name: "address", type: "text", max: 300 },
      { name: "notes", type: "text", max: 1000 },
    ],
    indexes: ["CREATE INDEX idx_employees_name ON employees (name)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("employees"));
  } catch (e) { /* already deleted */ }
});
