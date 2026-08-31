/**
 * 026_fix_payroll_zero_fields.js
 * payroll.allowances and payroll.deductions are legitimately 0; they must not
 * be `required` (PocketBase treats 0 as blank for required number fields).
 */
migrate((app) => {
  const col = app.findCollectionByNameOrId("payroll");
  for (const name of ["allowances", "deductions"]) {
    const field = col.fields.getByName(name);
    if (field) {
      field.required = false;
    }
  }
  app.save(col);
}, (app) => {
  // No-op down.
});
