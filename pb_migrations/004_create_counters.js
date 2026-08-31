/**
 * 004_create_counters.js
 * Sequential ID counters, keyed by prefix + date (e.g. "TR-20260828").
 */
migrate((app) => {
  app.save(new Collection({
    name: "counters",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "prefix", type: "text", required: true, max: 10 },
      { name: "date_key", type: "text", required: true, max: 10, pattern: "^\\d{8}$" },
      { name: "seq", type: "number", required: true, onlyInt: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_counters_key ON counters (prefix, date_key)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("counters"));
  } catch (e) { /* already deleted */ }
});
