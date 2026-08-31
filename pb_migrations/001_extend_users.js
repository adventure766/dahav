/**
 * 001_extend_users.js
 * Extend PocketBase's built-in users auth collection with DAHAV role fields.
 * (PocketBase 0.40 ships a default `users` auth collection; we add our fields
 *  rather than creating a conflicting collection.)
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("users");
  collection.listRule = "id = @request.auth.id || @request.auth.role = 'owner'";
  collection.viewRule = "id = @request.auth.id || @request.auth.role = 'owner' || @request.auth.role = 'manager'";
  collection.createRule = null; // superuser-only via API endpoint
  collection.updateRule = "id = @request.auth.id || @request.auth.role = 'owner'";
  collection.deleteRule = "@request.auth.role = 'owner'";

  const fieldsToAdd = [
    new Field({ name: "role", type: "select", required: true, values: ["owner", "manager", "cashier", "employee"], maxSelect: 1 }),
    new Field({ name: "phone", type: "text", max: 30 }),
    new Field({ name: "position", type: "text", max: 120 }),
    new Field({ name: "active", type: "bool" }),
    new Field({ name: "joined_at", type: "date" }),
  ];

  for (const f of fieldsToAdd) {
    const exists = collection.fields.filter((existing) => existing.name === f.name);
    if (exists.length === 0) {
      collection.fields.add(f);
    }
  }

  app.save(collection);
}, (app) => {
  // No-op down: the built-in users collection should stay.
});
