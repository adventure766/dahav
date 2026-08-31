/**
 * 006_create_audit_logs.js
 * Audit trail for financial record modifications.
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  app.save(new Collection({
    name: "audit_logs",
    type: "base",
    listRule: "@request.auth.role = 'owner' || @request.auth.role = 'manager'",
    viewRule: "@request.auth.role = 'owner' || @request.auth.role = 'manager'",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    fields: [
      { name: "collection", type: "text", required: true, max: 60 },
      { name: "record_id", type: "text", max: 120 },
      { name: "action", type: "text", required: true, max: 30 },
      { name: "reason", type: "text", max: 500 },
      { name: "before", type: "json" },
      { name: "after", type: "json" },
      { name: "by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX idx_audit_collection ON audit_logs (collection)",
      "CREATE INDEX idx_audit_record ON audit_logs (record_id)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("audit_logs"));
  } catch (e) { /* already deleted */ }
});
