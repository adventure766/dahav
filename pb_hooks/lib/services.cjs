/**
 * Server-side shared services: ID allocation, audit logging, settings access.
 * Runs inside PocketBase pb_hooks (goja).
 */

const { generateId, todayKey } = require("../engine/index.cjs");
const { can } = require("./constants.cjs");

/**
 * Allocate the next sequential ID for a prefix, atomically.
 * Reads the counter row, bumps it, saves. Unique index (prefix,date_key)
 * guarantees correctness under concurrency.
 */
function nextId(app, prefix, dateKey) {
  const key = dateKey || todayKey();
  let record = null;
  try {
    record = app.findFirstRecordByFilter("counters", `prefix = '${prefix}' && date_key = '${key}'`);
  } catch (e) {
    record = null;
  }
  const col = app.findCollectionByNameOrId("counters");
  if (!record) {
    record = new Record(col);
    record.set("prefix", prefix);
    record.set("date_key", key);
    record.set("seq", 1);
  } else {
    record.set("seq", (Number(record.get("seq")) || 0) + 1);
  }
  app.save(record);
  return generateId(prefix, record.get("seq"), key, true);
}

/**
 * Write an audit log entry.
 */
function audit(app, opts) {
  try {
    const col = app.findCollectionByNameOrId("audit_logs");
    const rec = new Record(col);
    rec.set("collection", opts.collection);
    rec.set("record_id", opts.record_id || "");
    rec.set("action", opts.action);
    rec.set("reason", opts.reason || "");
    if (opts.before !== undefined) {
      try { rec.set("before", JSON.stringify(opts.before)); } catch (e) { rec.set("before", "{}"); }
    }
    if (opts.after !== undefined) {
      try { rec.set("after", JSON.stringify(opts.after)); } catch (e) { rec.set("after", "{}"); }
    }
    rec.set("by", opts.by || "");
    app.save(rec);
  } catch (e) {
    console.error("audit failed", String(e));
  }
}

/** Fetch the settings record (singleton), or null. */
function getSettings(app) {
  try {
    return app.findFirstRecordByFilter("settings");
  } catch (e) {
    return null;
  }
}

/** Effective default exchange rate (1 USD = X SSP). */
function defaultRate(app) {
  const s = getSettings(app);
  return s ? Number(s.get("default_rate")) || 8000 : 8000;
}

/** Main currency for display/reporting. */
function mainCurrency(app) {
  const s = getSettings(app);
  return s ? String(s.get("currency") || "USD") : "USD";
}

/** Current authenticated user record (or null). */
function currentUser(app) {
  try {
    return app.authStore().model || null;
  } catch (e) {
    return null;
  }
}

/** Does the current user satisfy a permission? */
function canCurrent(app, permission) {
  const u = currentUser(app);
  if (!u) return false;
  return can(u.get("role"), permission);
}

module.exports = {
  nextId,
  audit,
  getSettings,
  defaultRate,
  mainCurrency,
  currentUser,
  canCurrent,
};
