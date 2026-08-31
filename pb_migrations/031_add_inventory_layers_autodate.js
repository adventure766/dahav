/**
 * 031_add_inventory_layers_autodate.js
 * Add `created`/`updated` autodate fields to inventory_layers.
 * FIFO ordering relies on layer creation time, so the `created` field is
 * required for correct oldest-first layer consumption.
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("inventory_layers");
  if (!col.fields.getByName("created")) {
    col.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  }
  if (!col.fields.getByName("updated")) {
    col.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  }
  app.save(col);
}, (app) => {
  // No-op down.
});
