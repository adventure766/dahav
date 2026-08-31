/**
 * 027_create_inventory_layers.js
 * FIFO inventory layers for cost-of-goods-sold calculation.
 *
 * Each stock-in (purchase) creates one or more layers with its purchase cost.
 * Sales and damage consume layers FIRST-IN-FIRST-OUT, so the exact cost of
 * goods sold reflects the actual purchase batches consumed.
 *
 * Layer lifecycle:
 *  - purchase   -> layer added with remaining_quantity = purchased qty
 *  - sale       -> layer reduced (FIFO order); fully consumed layers remain
 *                  with remaining_quantity = 0 for auditability
 *  - damage     -> layer reduced (FIFO order) at that layer's unit cost
 *
 * The product.unit_cost column is kept updated as the weighted cost of
 * remaining layers (for display + legacy reads), but authoritative COGS comes
 * from the layers consumed per sale item (sale_items.cogs).
 */
migrate((app) => {
  const productsId = app.findCollectionByNameOrId("products").id;
  const usersId = app.findCollectionByNameOrId("users").id;

  app.save(new Collection({
    name: "inventory_layers",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    deleteRule: "",
    fields: [
      { name: "product", type: "relation", collectionId: productsId, maxSelect: 1, cascadeDelete: false },
      { name: "quantity", type: "number", required: true, onlyInt: true }, // original purchased qty
      { name: "remaining_quantity", type: "number", required: true, onlyInt: true }, // qty still in stock from this layer
      { name: "unit_cost", type: "number", required: true, min: 0 },
      { name: "reference", type: "text", max: 200 }, // purchase reference / movement id
      { name: "notes", type: "text", max: 500 },
      { name: "by", type: "relation", collectionId: usersId, maxSelect: 1 },
    ],
    indexes: [
      "CREATE INDEX idx_layers_product ON inventory_layers (product)",
      "CREATE INDEX idx_layers_product_remaining ON inventory_layers (product, remaining_quantity)",
    ],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("inventory_layers"));
  } catch (e) { /* already deleted */ }
});
