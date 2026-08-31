/**
 * 007_create_product_categories.js
 */
migrate((app) => {
  app.save(new Collection({
    name: "product_categories",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "description", type: "text", max: 500 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_category_name ON product_categories (name)"],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("product_categories"));
  } catch (e) { /* already deleted */ }
});
