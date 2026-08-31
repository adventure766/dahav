/**
 * 032_fix_layers_remaining_optional.js
 * inventory_layers.remaining_quantity is legitimately 0 (fully consumed layer
 * kept for audit); must not be `required` (PocketBase treats 0 as blank).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("inventory_layers");
  const field = col.fields.getByName("remaining_quantity");
  if (field) {
    field.required = false;
  }
  app.save(col);
}, (app) => {
  // No-op down.
});
