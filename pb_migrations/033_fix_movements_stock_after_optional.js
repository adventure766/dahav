/**
 * 033_fix_movements_stock_after_optional.js
 * inventory_movements.stock_after is legitimately 0 (stock fully depleted);
 * must not be `required` (PocketBase treats 0 as blank for required numbers).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("inventory_movements");
  const field = col.fields.getByName("stock_after");
  if (field) {
    field.required = false;
  }
  app.save(col);
}, (app) => {
  // No-op down.
});
