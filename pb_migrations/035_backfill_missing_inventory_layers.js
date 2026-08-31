/**
 * 035_backfill_missing_inventory_layers.js
 * Ensure every product with positive stock has matching FIFO layers.
 *
 * Products created with an "Opening Stock" value (products.create with
 * `stock > 0`) used to write products.stock directly without creating an
 * inventory_layers row. The FIFO engine only sells from inventory_layers, so
 * those products showed stock in the UI but failed every sale with
 * "Insufficient FIFO inventory layers".
 *
 * This migration back-fills one opening-stock layer per such product from its
 * current stock at its current unit_cost — the same pattern migration 029 used
 * when the layers collection was introduced.
 *
 * Idempotent: products whose layer quantity already covers their stock are
 * skipped (a product may have partial coverage if some of its layers were
 * consumed by sales while other units came from direct stock writes).
 */
migrate((app) => {
  const products = app.findRecordsByFilter("products", "", "name", 100000, 0);
  for (const p of products) {
    const stock = Math.floor(Number(p.get("stock")) || 0);
    if (stock <= 0) continue;

    // Sum remaining quantity of this product's layers.
    const layers = app.findRecordsByFilter("inventory_layers", `product = '${p.id}'`, "created", 100000, 0);
    let covered = 0;
    for (const l of layers) {
      covered += Math.floor(Number(l.get("remaining_quantity")) || 0);
    }

    const missing = stock - covered;
    if (missing <= 0) continue; // already fully covered by layers

    const col = app.findCollectionByNameOrId("inventory_layers");
    const rec = new Record(col);
    rec.set("product", p.id);
    rec.set("quantity", missing);
    rec.set("remaining_quantity", missing);
    rec.set("unit_cost", Number(p.get("unit_cost")) || 0);
    rec.set("reference", "backfill-" + p.id);
    rec.set("notes", "Back-filled missing FIFO coverage on consistency migration");
    rec.set("by", "");
    app.save(rec);
  }
}, (app) => {
  // No-op down.
});
