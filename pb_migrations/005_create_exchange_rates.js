/**
 * 005_create_exchange_rates.js
 * Exchange-rate history — every rate change is recorded.
 */
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  app.save(new Collection({
    name: "exchange_rates",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'manager' || @request.auth.role = 'owner'",
    updateRule: "@request.auth.role = 'owner'",
    deleteRule: "",
    fields: [
      { name: "rate", type: "number", required: true, min: 0.0001 },
      { name: "note", type: "text", max: 300 },
      { name: "set_by", type: "relation", collectionId: usersId, maxSelect: 1 },
    ],
    indexes: [],
  }));
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("exchange_rates"));
  } catch (e) { /* already deleted */ }
});
