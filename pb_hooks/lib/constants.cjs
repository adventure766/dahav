/**
 * Shared domain constants used by both pb_hooks and the frontend.
 * Plain CJS so PocketBase can require() it.
 */

const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  CASHIER: "cashier",
  EMPLOYEE: "employee",
};

const ROLE_RANK = {
  owner: 4,
  manager: 3,
  cashier: 2,
  employee: 1,
};

/**
 * Permission matrix. Keys are permission names; values are the minimum role
 * rank required. Higher rank = more privilege.
 */
const PERMISSIONS = {
  // Core operations
  "pos.sell": ROLES.CASHIER, // rank 2
  "sales.create": ROLES.CASHIER,
  "sales.view": ROLES.CASHIER,
  "sales.edit": ROLES.MANAGER,
  "sales.void": ROLES.MANAGER,
  "sales.delete": ROLES.OWNER,
  // Payments
  "payments.create": ROLES.CASHIER,
  "payments.view": ROLES.CASHIER,
  "payments.edit": ROLES.MANAGER,
  "payments.void": ROLES.MANAGER,
  "payments.delete": ROLES.OWNER,
  // Products & inventory
  "products.create": ROLES.MANAGER,
  "products.edit": ROLES.MANAGER,
  "products.delete": ROLES.OWNER,
  "inventory.adjust": ROLES.MANAGER,
  "inventory.damage": ROLES.MANAGER,
  // Expenses
  "expenses.create": ROLES.MANAGER,
  "expenses.edit": ROLES.MANAGER,
  "expenses.void": ROLES.MANAGER,
  "expenses.delete": ROLES.OWNER,
  // Customers
  "customers.create": ROLES.CASHIER,
  "customers.edit": ROLES.MANAGER,
  "customers.delete": ROLES.OWNER,
  // Employees & payroll
  "employees.create": ROLES.MANAGER,
  "employees.edit": ROLES.MANAGER,
  "employees.delete": ROLES.OWNER,
  "payroll.create": ROLES.MANAGER,
  "payroll.edit": ROLES.MANAGER,
  "payroll.void": ROLES.OWNER,
  "payroll.delete": ROLES.OWNER,
  // Damage & inventory losses
  "damage.delete": ROLES.OWNER,
  // Ledger transactions
  "transactions.delete": ROLES.OWNER,
  // Suppliers
  "suppliers.create": ROLES.MANAGER,
  "suppliers.edit": ROLES.MANAGER,
  "suppliers.delete": ROLES.OWNER,
  // Exchange rates
  "rates.view": ROLES.CASHIER,
  "rates.edit": ROLES.MANAGER,
  "rates.edit_history": ROLES.MANAGER,
  // Reports & dashboard
  "reports.view": ROLES.MANAGER,
  "dashboard.view": ROLES.CASHIER,
  // Settings & users
  "settings.view": ROLES.MANAGER,
  "settings.edit": ROLES.OWNER,
  "users.manage": ROLES.OWNER,
};

/** Return the numeric rank for a role, or 0. */
function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

/** Does `role` satisfy `permission`? */
function can(role, permission) {
  const needed = PERMISSIONS[permission];
  if (needed === undefined) return false;
  return roleRank(role) >= roleRank(needed);
}

const TRANSACTION_TYPES = [
  "sale",
  "sale_refund",
  "payment",
  "payment_refund",
  "expense",
  "salary",
  "damage",
  "other_income",
  "other_outgoing",
  "inventory_adjustment",
];

const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "mobile_money", "credit", "other"];

const SALE_STATUS = ["completed", "partial", "credit", "void"];
const PAYMENT_STATUS = ["paid", "partial", "pending", "void", "refunded"];
const PAYROLL_STATUS = ["paid", "unpaid", "void"];
const MOVEMENT_TYPES = ["purchase", "sale", "return", "damage", "adjustment"];

module.exports = {
  ROLES,
  ROLE_RANK,
  PERMISSIONS,
  roleRank,
  can,
  TRANSACTION_TYPES,
  PAYMENT_METHODS,
  SALE_STATUS,
  PAYMENT_STATUS,
  PAYROLL_STATUS,
  MOVEMENT_TYPES,
};
