/**
 * 029_backfill_inventory_layers.js
 * Back-fill FIFO layers for products that already hold stock.
 *
 * Products created before the FIFO layers collection (027) have a running
 * `stock` and `unit_cost` but no layers. This migration seeds one layer per
 * product from its current stock at its current unit_cost so existing
 * inventory remains sellable and its COGS stays consistent.
 *
 * Idempotent: products that already have layers are skipped.
 */
migrate((app) => {
  const products = app.findRecordsByFilter("products", "", "name", 100000, 0);
  for (const p of products) {
    const stock = Math.floor(Number(p.get("stock")) || 0);
    if (stock <= 0) continue;
    const existing = app.findRecordsByFilter("inventory_layers", `product = '${p.id}'`, "", 1, 0);
    if (existing.length > 0) continue; // already has layers
    const col = app.findCollectionByNameOrId("inventory_layers");
    const rec = new Record(col);
    rec.set("product", p.id);
    rec.set("quantity", stock);
    rec.set("remaining_quantity", stock);
    rec.set("unit_cost", Number(p.get("unit_cost")) || 0);
    rec.set("reference", "backfill-" + p.id);
    rec.set("notes", "Back-filled from existing stock on FIFO migration");
    rec.set("by", "");
    app.save(rec);
  }
}, (app) => {
  // No-op down.
});
