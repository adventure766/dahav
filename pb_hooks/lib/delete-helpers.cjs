/**
 * DAHAV cascade-delete helpers.
 * IMPORTANT: goja handlers can only see require'd modules + their own scope;
 * top-level function declarations in main.pb.js are NOT visible inside
 * handler closures. These helpers live in a module so handlers can require().
 */

/** Run a callback inside a DB transaction. */
function deleteInTxn(app, fn) {
  return app.runInTransaction((txApp) => fn(txApp));
}

/** Delete every record matching the filter in the given collection. */
function deleteChildRecords(app, collection, filter) {
  const rows = app.findRecordsByFilter(collection, filter, "", 100000, 0);
  for (const r of rows) app.delete(r);
  return rows.length;
}

module.exports = {
  deleteInTxn,
  deleteChildRecords,
};
