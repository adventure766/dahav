/**
 * 024_add_audit_created.js
 * Add the `created` autodate field to audit_logs (missing from original schema).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("audit_logs");
  if (!col.fields.getByName("created")) {
    col.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
    app.save(col);
  }
}, (app) => {
  // No-op down.
});
