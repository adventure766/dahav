/**
 * 009_create_inventory_movements.js
 */
migrate((app) => {
  const productsId = app.findCollectionByNameOrId("products").id;
  const usersId = app.findCollectionByNameOrId("users").id;

  app.save(new Collection({
    name: "inventory_movements",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "",
    deleteRule: "",
    fields: [
      { name: "product", type: "relation", collectionId: productsId, maxSelect: 1, cascadeDelete: false },
      { name: "movement_type", type: "select", required: true, values: ["purchase", "sale", "return", "damage", "adjustment"], maxSelect: 1 },
      { name: "quantity", type: "number", required: true, onlyInt: true },
      { name: "unit_cost", type: "number", min: 0 },
      { name: "stock_after", type: "number", required: true, onlyInt: true },
      { name: "reference", type: "text", max: 200 },
      { name: "notes", type: "text", max: 500 },
      { name: "by", type: "relation", collectionId: usersId, maxSelect: 1 },
    ],
    indexes: [
      "CREATE INDEX idx_movements_product ON inventory_movements (product)",
      "CREATE INDEX idx_movements_type ON inventory_movements (movement_type)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("inventory_movements"));
  } catch (e) { /* already deleted */ }
});
