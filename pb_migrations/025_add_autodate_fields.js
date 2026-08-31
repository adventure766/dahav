/**
 * 025_add_autodate_fields.js
 * Add `created` and `updated` autodate fields to every DAHAV collection.
 * (These were missing from the original schema and are needed for sorting,
 *  audit trails, and display timestamps.)
 */
migrate((app) => {
  const collections = [
    "settings", "counters", "exchange_rates", "audit_logs",
    "product_categories", "products", "inventory_movements",
    "customers", "sales", "sale_items", "invoices",
    "payments", "receipts", "expense_categories", "suppliers", "expenses",
    "employees", "payroll", "damage_records", "transactions",
  ];
  for (const name of collections) {
    try {
      const col = app.findCollectionByNameOrId(name);
      if (!col.fields.getByName("created")) {
        col.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
      }
      if (!col.fields.getByName("updated")) {
        col.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
      }
      app.save(col);
    } catch (e) {
      console.log("skip", name, String(e));
    }
  }
}, (app) => {
  // No-op down.
});
