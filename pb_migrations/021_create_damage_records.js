/**
 * 021_create_damage_records.js
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const transactionsId = app.findCollectionByNameOrId("transactions").id;
  const productsId = app.findCollectionByNameOrId("products").id;

  app.save(new Collection({
    name: "damage_records",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "damage_id", type: "text", required: true, max: 60 },
      { name: "transaction", type: "relation", collectionId: transactionsId, maxSelect: 1 },
      { name: "product", type: "relation", collectionId: productsId, maxSelect: 1 },
      { name: "by", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "quantity", type: "number", required: true, min: 0, onlyInt: true },
      { name: "unit_cost", type: "number", required: true, min: 0 },
      { name: "total_cost", type: "number", required: true, min: 0 },
      { name: "damage_date", type: "date" },
      { name: "reason", type: "text", max: 500 },
      { name: "notes", type: "text", max: 1000 },
    ],
    indexes: [
      "CREATE INDEX idx_damage_product ON damage_records (product)",
      "CREATE INDEX idx_damage_transaction ON damage_records (transaction)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("damage_records"));
  } catch (e) { /* already deleted */ }
});
