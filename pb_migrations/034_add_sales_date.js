/**
 * 034_add_sales_date.js
 * Add `date` to sales so sales can be recorded/backdated to a business date
 * distinct from the record's `created` autodate. Reports and the dashboard
 * filter on this business date (mirrors expenses.expense_date).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("sales");
  if (!col.fields.getByName("date")) {
    col.fields.add(new DateField({ name: "date" }));
    app.save(col);
  }
}, (app) => {
  // No-op down.
});
