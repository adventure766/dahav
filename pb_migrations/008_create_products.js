/**
 * 008_create_products.js
 */
migrate((app) => {
  const categoriesId = app.findCollectionByNameOrId("product_categories").id;

  app.save(new Collection({
    name: "products",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "name", type: "text", required: true, max: 200 },
      { name: "sku", type: "text", max: 80 },
      { name: "category", type: "relation", collectionId: categoriesId, maxSelect: 1 },
      { name: "barcode", type: "text", max: 100 },
      { name: "unit_price", type: "number", required: true, min: 0 },
      { name: "unit_cost", type: "number", required: true, min: 0 },
      { name: "stock", type: "number", required: true, min: 0, onlyInt: true },
      { name: "low_stock_threshold", type: "number", min: 0, onlyInt: true },
      { name: "currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "active", type: "bool" },
      { name: "image", type: "file", maxSelect: 1, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    ],
    indexes: [
      "CREATE INDEX idx_products_name ON products (name)",
      "CREATE INDEX idx_products_sku ON products (sku)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("products"));
  } catch (e) { /* already deleted */ }
});
