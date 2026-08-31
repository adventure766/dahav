/**
 * 030_fix_products_stock_optional.js
 * products.stock is legitimately 0 (new product with no inventory yet);
 * it must not be `required` (PocketBase treats 0 as blank for required numbers).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("products");
  const field = col.fields.getByName("stock");
  if (field) {
    field.required = false;
  }
  app.save(col);
}, (app) => {
  // No-op down.
});
