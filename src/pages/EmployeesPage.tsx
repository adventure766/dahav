import { useEffect, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd, ssp, rateLabel } from "../lib/currency";
import { useAuthUser } from "../components/useAuthUser";
import type { Currency } from "../lib/engine";

interface Employee {
  id: string;
  name: string;
  phone: string;
  email: string;
  position: string;
  status: string;
  salary: number;
  salary_currency: string;
  join_date: string;
  created: string;
}

interface Payroll {
  id: string;
  payroll_id: string;
  employee: string;
  period: string;
  base_salary: number;
  allowances: number;
  deductions: number;
  net_salary: number;
  currency: string;
  exchange_rate: number;
  amount_usd: number;
  status: string;
  payment_date: string;
  created: string;
}

export function EmployeesPage() {
  const user = useAuthUser();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [tab, setTab] = useState<"employees" | "payroll">("employees");
  const [showEmp, setShowEmp] = useState(false);
  const [showPay, setShowPay] = useState<Employee | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [empForm, setEmpForm] = useState({ name: "", phone: "", email: "", position: "", salary: "", salary_currency: "SSP", join_date: "" });
  const [payForm, setPayForm] = useState({ period: "", base_salary: "", allowances: "0", deductions: "0", currency: "SSP" as Currency, useCustomRate: false, customRate: "", payment_date: "" });

  const load = useCallback(async () => {
    const pb = getPb();
    const [e, p] = await Promise.all([
      pb.collection("employees").getFullList<Employee>({ sort: "name" }),
      pb.collection("payroll").getFullList<Payroll>({ sort: "-created" }),
    ]);
    setEmployees(e);
    setPayroll(p);
  }, []);

  useEffect(() => { load().catch((e) => setError("Failed to load: " + e.message)); }, [load]);

  const canManage = user?.role === "manager" || user?.role === "owner";

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const pb = getPb();
    try {
      await pb.collection("employees").create({
        name: empForm.name,
        phone: empForm.phone,
        email: empForm.email,
        position: empForm.position,
        status: "active",
        salary: Number(empForm.salary),
        salary_currency: empForm.salary_currency,
        join_date: empForm.join_date || undefined,
      });
      await load();
      setShowEmp(false);
      setEmpForm({ name: "", phone: "", email: "", position: "", salary: "", salary_currency: "SSP", join_date: "" });
      setSuccess("Employee added");
    } catch (err) {
      setError("Create failed: " + (err as Error).message);
    }
  };

  const openPay = (emp: Employee) => {
    setShowPay(emp);
    setPayForm({ period: "", base_salary: String(emp.salary), allowances: "0", deductions: "0", currency: emp.salary_currency as Currency, useCustomRate: false, customRate: "", payment_date: "" });
  };

  const submitPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPay) return;
    setError(""); setSuccess("");
    const r = await api("/api/dahav/payroll/create", {
      method: "POST",
      body: {
        employee_id: showPay.id,
        period: payForm.period,
        base_salary: Number(payForm.base_salary),
        allowances: Number(payForm.allowances),
        deductions: Number(payForm.deductions),
        currency: payForm.currency,
        exchange_rate: payForm.useCustomRate ? Number(payForm.customRate) : undefined,
        payment_method: "cash",
        payment_date: payForm.payment_date || undefined,
      },
    });
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "Payroll failed"); return; }
    const res = r.data as { calculation?: { net: number; amount_usd: number; currency: string } };
    await load();
    setShowPay(null);
    if (res.calculation) {
      setSuccess(`Salary paid: ${res.calculation.currency === "SSP" ? ssp(res.calculation.net) : usd(res.calculation.net)} (USD ${usd(res.calculation.amount_usd)})`);
    } else {
      setSuccess("Salary paid");
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Employees &amp; Payroll</h1>
        <div className="tab-row">
          <button className={`btn small ${tab === "employees" ? "primary" : "ghost"}`} onClick={() => setTab("employees")}>Employees</button>
          <button className={`btn small ${tab === "payroll" ? "primary" : "ghost"}`} onClick={() => setTab("payroll")}>Payroll ({payroll.length})</button>
          {canManage && tab === "employees" && <button className="btn primary small" onClick={() => setShowEmp(true)}>+ Add Employee</button>}
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {tab === "employees" && (
        <div className="card table-wrap">
          <table className="employees-table">
            <thead>
              <tr><th>Name</th><th>Position</th><th>Phone</th><th>Salary</th><th>Currency</th><th>Status</th><th>Joined</th><th></th></tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>{emp.name}</td>
                  <td>{emp.position || "—"}</td>
                  <td className="muted">{emp.phone || "—"}</td>
                  <td className="money-usd">{usd(emp.salary)}</td>
                  <td>{emp.salary_currency}</td>
                  <td><span className={`badge ${emp.status === "active" ? "green" : "gray"}`}>{emp.status}</span></td>
                  <td className="muted">{emp.join_date ? new Date(emp.join_date).toLocaleDateString() : "—"}</td>
                  <td>
                    {canManage && <button className="btn small" onClick={() => openPay(emp)}>Pay Salary</button>}{" "}
                    {user?.role === "owner" && (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete employee "${emp.name}"? Their payroll records and ledger transactions will also be deleted.`)) return;
                          const r = await api(`/api/dahav/records/employees/${emp.id}`, { method: "DELETE" });
                          if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); return; }
                          setSuccess(`Employee "${emp.name}" deleted`);
                          await load();
                        }}
                        aria-label={`Delete ${emp.name}`}
                      >
                        <Trash2 size={14} style={{ verticalAlign: "-2px" }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={8} className="empty">No employees yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payroll" && (
        <div className="card table-wrap">
          <table className="employees-payroll-table">
            <thead>
              <tr><th>ID</th><th>Employee</th><th>Period</th><th>Base</th><th>Allow</th><th>Deduct</th><th>Net</th><th>Currency</th><th>Rate</th><th>USD</th><th>Status</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {payroll.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{p.payroll_id}</td>
                  <td>{employees.find((em) => em.id === p.employee)?.name || "—"}</td>
                  <td>{p.period || "—"}</td>
                  <td className="money-usd">{usd(p.base_salary)}</td>
                  <td className="money-usd">{usd(p.allowances)}</td>
                  <td className="money-usd">−{usd(p.deductions)}</td>
                  <td className={p.currency === "SSP" ? "money-ssp" : "money-usd"}>{p.currency === "SSP" ? ssp(p.net_salary) : usd(p.net_salary)}</td>
                  <td>{p.currency}</td>
                  <td className="muted">{rateLabel(p.exchange_rate)}</td>
                  <td className="money-usd">{usd(p.amount_usd)}</td>
                  <td><span className={`badge ${p.status === "paid" ? "green" : "yellow"}`}>{p.status}</span></td>
                  <td className="muted">{new Date(p.payment_date || p.created).toLocaleDateString()}</td>
                  <td className="no-print">
                    {user?.role === "owner" && (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete payroll ${p.payroll_id}? Its ledger transaction will also be deleted.`)) return;
                          const r = await api(`/api/dahav/records/payroll/${p.id}`, { method: "DELETE" });
                          if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); return; }
                          setSuccess(`Payroll ${p.payroll_id} deleted`);
                          await load();
                        }}
                        aria-label={`Delete ${p.payroll_id}`}
                      >
                        <Trash2 size={14} style={{ verticalAlign: "-2px" }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {payroll.length === 0 && <tr><td colSpan={13} className="empty">No payroll payments yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showEmp && (
        <div className="modal-overlay" onClick={() => setShowEmp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Employee</h2>
            <form onSubmit={createEmployee}>
              <label>Name <input required value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} /></label>
              <div className="grid cols-2">
                <label>Phone <input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} /></label>
                <label>Position <input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} /></label>
              </div>
              <div className="grid cols-2">
                <label>Salary <input type="number" step="0.01" min="0" required value={empForm.salary} onChange={(e) => setEmpForm({ ...empForm, salary: e.target.value })} /></label>
                <label>Salary Currency
                  <select value={empForm.salary_currency} onChange={(e) => setEmpForm({ ...empForm, salary_currency: e.target.value })}>
                    <option value="USD">USD</option>
                    <option value="SSP">SSP</option>
                  </select>
                </label>
              </div>
              <label>Join Date <input type="date" value={empForm.join_date} onChange={(e) => setEmpForm({ ...empForm, join_date: e.target.value })} /></label>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowEmp(false)}>Cancel</button>
                <button type="submit" className="btn primary">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPay && (
        <div className="modal-overlay" onClick={() => setShowPay(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Pay Salary — {showPay.name}</h2>
            <form onSubmit={submitPayroll}>
              <div className="grid cols-2">
                <label>Period <input placeholder="2026-08" value={payForm.period} onChange={(e) => setPayForm({ ...payForm, period: e.target.value })} /></label>
                <label>Payment Date <input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} /></label>
              </div>
              <div className="grid cols-3">
                <label>Base <input type="number" step="0.01" min="0" required value={payForm.base_salary} onChange={(e) => setPayForm({ ...payForm, base_salary: e.target.value })} /></label>
                <label>Allowances <input type="number" step="0.01" min="0" value={payForm.allowances} onChange={(e) => setPayForm({ ...payForm, allowances: e.target.value })} /></label>
                <label>Deductions <input type="number" step="0.01" min="0" value={payForm.deductions} onChange={(e) => setPayForm({ ...payForm, deductions: e.target.value })} /></label>
              </div>
              <div className="grid cols-2">
                <label>Currency
                  <select value={payForm.currency} onChange={(e) => setPayForm({ ...payForm, currency: e.target.value as Currency })}>
                    <option value="USD">USD</option>
                    <option value="SSP">SSP</option>
                  </select>
                </label>
                <label className="rate-toggle" style={{ alignSelf: "end", marginBottom: 12 }}>
                  <input type="checkbox" checked={payForm.useCustomRate} onChange={(e) => setPayForm({ ...payForm, useCustomRate: e.target.checked })} />
                  Custom rate
                </label>
              </div>
              {payForm.useCustomRate && (
                <label>Exchange Rate (1 USD = X SSP)
                  <input type="number" step="any" min="0.0001" required value={payForm.customRate} onChange={(e) => setPayForm({ ...payForm, customRate: e.target.value })} />
                </label>
              )}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowPay(null)}>Cancel</button>
                <button type="submit" className="btn primary">Pay Salary</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
