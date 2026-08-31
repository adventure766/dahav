/**
 * 028_add_sale_item_fifo_breakdown.js
 * Add `fifo_breakdown` to sale_items — a JSON audit trail of the exact FIFO
 * inventory layers consumed to determine each line's COGS.
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("sale_items");
  if (!col.fields.getByName("fifo_breakdown")) {
    col.fields.add(new JSONField({ name: "fifo_breakdown" }));
    app.save(col);
  }
}, (app) => {
  // No-op down.
});
