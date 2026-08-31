import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { getPb, verifyDahavServer, connectTo, isSameOrigin } from "./lib/pb";
import { authState, setAuth, login } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { ConnectPage } from "./pages/ConnectPage";
import { Shell } from "./components/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { PosPage } from "./pages/PosPage";
import { SalesPage } from "./pages/SalesPage";
import { SaleDetailPage } from "./pages/SaleDetailPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { TransactionDetailPage } from "./pages/TransactionDetailPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UpdateBanner } from "./components/UpdateBanner";
import { can } from "./lib/permissions";

export default function App() {
  const [bootState, setBootState] = useState<"loading" | "connect" | "ready">("loading");
  const [user, setUser] = useState(authState.user);

  useEffect(() => {
    (async () => {
      // 1. Same-origin primary
      const origin = window.location.origin;
      const sameOrigin = isSameOrigin();

      if (sameOrigin) {
        // We're served from PocketBase — try to load the session
        try {
          const pb = getPb();
          if (pb.authStore.isValid) {
            const record = await pb.collection("users").authRefresh();
            setAuth(record.record as never, pb.authStore.token);
            setUser(authState.user);
            setBootState("ready");
            return;
          }
        } catch (e) {
          // session invalid — fall through to login
        }
        setBootState("ready");
        return;
      }

      // 2. Dev mode — try the default origin, else saved backend, else manual
      const v = await verifyDahavServer(origin);
      if (v.ok) {
        await connectTo(origin);
        setBootState("ready");
        return;
      }
      const saved = localStorage.getItem("dahav_backend_url");
      if (saved) {
        const sv = await verifyDahavServer(saved);
        if (sv.ok) {
          await connectTo(saved);
          setBootState("ready");
          return;
        }
        localStorage.removeItem("dahav_backend_url");
      }
      // 3. Manual connect fallback
      setBootState("connect");
    })();
  }, []);

  if (bootState === "loading") {
    return <div className="boot-screen">Loading DAHAV…</div>;
  }

  if (bootState === "connect") {
    return <ConnectPage onConnected={() => setBootState("ready")} />;
  }

  if (!user) {
    return (
      <LoginPage
        onLogin={async (email, password) => {
          const u = await login(email, password);
          setUser(u);
        }}
      />
    );
  }

  const requirePerm = (perm: string) => {
    return can(user.role, perm) ? null : <Navigate to="/" replace />;
  };

  return (
    <>
      <UpdateBanner />
      <Shell user={user} onLogout={() => { setAuth(null, null); setUser(null); }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pos" element={requirePerm("pos.sell") ?? <PosPage />} />
          <Route path="/sales" element={requirePerm("sales.view") ?? <SalesPage />} />
          <Route path="/sales/:id" element={requirePerm("sales.view") ?? <SaleDetailPage />} />
          <Route path="/payments" element={requirePerm("payments.view") ?? <PaymentsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/expenses" element={requirePerm("expenses.create") ?? <ExpensesPage />} />
          <Route path="/employees" element={requirePerm("employees.create") ?? <EmployeesPage />} />
          <Route path="/reports" element={requirePerm("reports.view") ?? <ReportsPage />} />
          <Route path="/transactions/:id" element={requirePerm("reports.view") ?? <TransactionDetailPage />} />
          <Route path="/settings" element={requirePerm("settings.view") ?? <SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </>
  );
}
