/**
 * 012_create_sale_items.js
 */
migrate((app) => {
  const salesId = app.findCollectionByNameOrId("sales").id;
  const productsId = app.findCollectionByNameOrId("products").id;

  app.save(new Collection({
    name: "sale_items",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'cashier' || @request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "sale", type: "relation", collectionId: salesId, maxSelect: 1, cascadeDelete: true },
      { name: "product", type: "relation", collectionId: productsId, maxSelect: 1 },
      { name: "product_name", type: "text", required: true, max: 200 },
      { name: "quantity", type: "number", required: true, min: 0 },
      { name: "unit_price", type: "number", required: true, min: 0 },
      { name: "unit_cost", type: "number", required: true, min: 0 },
      { name: "line_total", type: "number", required: true, min: 0 },
      { name: "cogs", type: "number", required: true, min: 0 },
    ],
    indexes: ["CREATE INDEX idx_sale_items_sale ON sale_items (sale)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("sale_items"));
  } catch (e) { /* already deleted */ }
});
