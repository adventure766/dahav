/**
 * 023_fix_zeroable_number_fields.js
 * Number fields that legitimately hold 0 (discount, paid, outstanding, change,
 * tendered) must not be `required` — PocketBase treats 0 as "blank" for
 * required number fields.
 */
migrate((app) => {
  const fixes = [
    ["sales", "discount"],
    ["sales", "amount_paid"],
    ["sales", "amount_outstanding"],
    ["payments", "tendered"],
    ["payments", "change"],
    ["invoices", "amount_paid"],
    ["invoices", "amount_outstanding"],
  ];
  for (const [collectionName, fieldName] of fixes) {
    try {
      const col = app.findCollectionByNameOrId(collectionName);
      const field = col.fields.getByName(fieldName);
      if (field) {
        field.required = false;
      }
      app.save(col);
    } catch (e) {
      // collection/field may not exist yet — skip
    }
  }
}, (app) => {
  // No-op down.
});
