/**
 * Role constants + permission matrix (shared with the server via pb_hooks).
 * The server enforces these; the frontend uses them for UI gating only.
 */

export const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  CASHIER: "cashier",
  EMPLOYEE: "employee",
} as const;

export const PERMISSIONS = {
  "pos.sell": "cashier",
  "sales.create": "cashier",
  "sales.view": "cashier",
  "sales.edit": "manager",
  "sales.void": "manager",
  "sales.delete": "owner",
  "payments.create": "cashier",
  "payments.view": "cashier",
  "payments.edit": "manager",
  "payments.void": "manager",
  "payments.delete": "owner",
  "products.create": "manager",
  "products.edit": "manager",
  "products.delete": "owner",
  "inventory.adjust": "manager",
  "inventory.damage": "manager",
  "expenses.create": "manager",
  "expenses.edit": "manager",
  "expenses.void": "manager",
  "expenses.delete": "owner",
  "customers.create": "cashier",
  "customers.edit": "manager",
  "customers.delete": "owner",
  "employees.create": "manager",
  "employees.edit": "manager",
  "employees.delete": "owner",
  "payroll.create": "manager",
  "payroll.edit": "manager",
  "payroll.void": "owner",
  "rates.view": "cashier",
  "rates.edit": "manager",
  "rates.edit_history": "manager",
  "reports.view": "manager",
  "dashboard.view": "cashier",
  "settings.view": "manager",
  "settings.edit": "owner",
  "users.manage": "owner",
} as const;
