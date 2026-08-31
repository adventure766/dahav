import { useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, ReceiptText, CreditCard, Users, Package,
  Wallet, UserRound, BarChart3, Settings, Menu, LogOut, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import type { StaffUser } from "../lib/api";
import { APP_VERSION } from "../lib/updater";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager", "cashier", "employee"] },
  { to: "/pos", label: "POS", icon: ShoppingCart, roles: ["owner", "manager", "cashier"] },
  { to: "/sales", label: "Sales", icon: ReceiptText, roles: ["owner", "manager", "cashier"] },
  { to: "/payments", label: "Payments", icon: CreditCard, roles: ["owner", "manager", "cashier"] },
  { to: "/customers", label: "Customers", icon: Users, roles: ["owner", "manager", "cashier"] },
  { to: "/products", label: "Products", icon: Package, roles: ["owner", "manager"] },
  { to: "/expenses", label: "Expenses", icon: Wallet, roles: ["owner", "manager"] },
  { to: "/employees", label: "Employees", icon: UserRound, roles: ["owner", "manager"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["owner", "manager"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
];

const COLLAPSE_KEY = "dahav_sidebar_collapsed";

export function Shell({ user, onLogout, children }: { user: StaffUser; onLogout: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const location = useLocation();

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const current = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className={`shell ${collapsed ? "shell-collapsed" : ""}`}>
      <header className="topbar">
        <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          <Menu size={22} />
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">D</span>
          DAHAV
        </Link>
        <span className="topbar-title">{current ? current.label : ""}</span>
        <div className="topbar-right">
          <span className="user-chip">
            {user.name} <em>({user.role})</em>
          </span>
          <button className="btn ghost small" onClick={onLogout}>
            <LogOut size={15} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Logout
          </button>
        </div>
      </header>

      <div className={`layout ${open ? "nav-open" : ""}`}>
        <nav className="sidebar">
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
                <span className="nav-label">{n.label}</span>
              </NavLink>
            );
          })}
          <button
            className="nav-item sidebar-toggle"
            onClick={toggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            <span className="nav-icon">
              {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            </span>
            <span className="nav-label">{collapsed ? "" : "Collapse"}</span>
          </button>
          <div className="sidebar-footer" title={`DAHAV v${APP_VERSION}`}>
            <span className="nav-icon"><span className="dot" /></span>
            <span className="nav-label">v{APP_VERSION}</span>
          </div>
        </nav>
        <main className="content" onClick={() => open && setOpen(false)}>
          {children}
        </main>
      </div>
    </div>
  );
}
