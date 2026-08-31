/**
 * 002_create_settings.js
 * Company + application settings (single record).
 * main_currency: "USD" | "SSP"  — display/reporting currency.
 * default_rate:  1 USD = X SSP.
 */
migrate((app) => {
  const collection = new Collection({
    name: "settings",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'owner'",
    deleteRule: "@request.auth.role = 'owner'",
    fields: [
      { name: "company_name", type: "text", max: 200 },
      { name: "address", type: "text", max: 300 },
      { name: "phone", type: "text", max: 40 },
      { name: "email", type: "text", max: 120 },
      { name: "tax_id", type: "text", max: 100 },
      { name: "currency", type: "text", required: true, max: 10, pattern: "^[A-Z]{3}$" },
      { name: "default_rate", type: "number", required: true, min: 0.0001 },
      { name: "logo", type: "text", max: 255 },
    ],
    indexes: [],
  });
  app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("settings");
    app.delete(collection);
  } catch (e) { /* already deleted */ }
});
