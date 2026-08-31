/**
 * 022_seed_settings.js
 * Seed the singleton settings record (company + default exchange rate).
 */
migrate((app) => {
  let existing = null;
  try {
    existing = app.findFirstRecordByFilter("settings");
  } catch (e) { existing = null; }
  if (!existing) {
    const col = app.findCollectionByNameOrId("settings");
    const rec = new Record(col);
    rec.set("company_name", "DAHAV General Trading Co. Ltd");
    rec.set("address", "");
    rec.set("phone", "");
    rec.set("email", "");
    rec.set("tax_id", "");
    rec.set("currency", "USD");
    rec.set("default_rate", 8000);
    app.save(rec);
  }
}, (app) => {
  // No-op down: keep the settings record.
});
