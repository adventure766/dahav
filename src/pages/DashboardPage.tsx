import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { getPb } from "../lib/pb";
import { usd, ssp, rateLabel } from "../lib/currency";
import { periodFor, PERIOD_OPTIONS, type Period, type PeriodKey } from "../lib/periods";
import { TrendChart, type SeriesPoint } from "../components/TrendChart";
import { CardSkeleton, SectionError, EmptyState } from "../components/Feedback";
import { useAuthUser } from "../components/useAuthUser";
import type { StaffUser } from "../lib/api";

interface DashboardSummary {
  period: { from: string | null; to: string | null };
  revenue: number;
  collected: number;
  outstanding: number;
  expenses: number;
  cogs: number;
  gross_profit: number;
  net_profit: number;
  damage_loss: number;
  payroll: number;
  inventory_value: number;
  inventory_units: number;
  sales_count: number;
  payment_count: number;
  expense_count: number;
  product_count: number;
  currency: string;
  default_rate: number;
  currency_totals: { received_ssp: number; received_usd: number; spent_ssp: number; spent_usd: number };
  low_stock: Array<{ product_id: string; name: string; sku: string; stock: number; low_stock_threshold: number }>;
  out_of_stock: Array<{ product_id: string; name: string; sku: string; stock: number }>;
}

interface PreviousSummary {
  revenue: number;
  net_profit: number;
  expenses: number;
  outstanding: number;
}

interface ActivityItem {
  type: string;
  date: string;
  description: string;
  amount: number;
  transaction_id: string;
  user: string;
  link: { type: string; id: string } | null;
}

interface RecentTxn {
  date: string;
  transaction_id: string;
  type: string;
  customer: string;
  amount_usd: number;
  original_amount: number;
  original_currency: string;
  status: string;
  link: { type: string; id: string } | null;
}

interface Debtor {
  name: string;
  total_purchases: number;
  total_paid: number;
  outstanding: number;
}

type Granularity = "day" | "week" | "month";

const PERIOD_SHORT: PeriodKey[] = ["today", "this_week", "this_month", "this_year", "custom"];

function greeting(user: StaffUser | null): string {
  if (!user?.name) return "Welcome back";
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${user.name.split(" ")[0]}`;
}

/** Single quiet delta vs previous period: "−34% vs prev." Returns null when unmeasurable. */
function deltaPct(cur: number, prev: number | undefined): string | null {
  if (typeof prev !== "number" || prev === 0) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return "same as previous period";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% vs previous period`;
}

export function DashboardPage() {
  const pb = getPb();
  const user = useAuthUser();

  const [periodKey, setPeriodKey] = useState<PeriodKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [period, setPeriod] = useState<Period>(() => periodFor("this_month"));
  const [granularity, setGranularity] = useState<Granularity>("month");

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [prev, setPrev] = useState<PreviousSummary | null>(null);
  const [perf, setPerf] = useState<SeriesPoint[] | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [txns, setTxns] = useState<RecentTxn[] | null>(null);
  const [txnsLoading, setTxnsLoading] = useState(true);
  const [debtors, setDebtors] = useState<Debtor[] | null>(null);
  const [debtorsLoading, setDebtorsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const headers: Record<string, string> = pb.authStore.token ? { Authorization: pb.authStore.token } : {};

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError("");
    const q = `from=${period.from}&to=${period.to}`;
    try {
      const [d, p] = await Promise.all([
        fetch(`${pb.baseUrl}/api/dahav/dashboard?${q}`, { headers }).then((r) => r.json()),
        fetch(`${pb.baseUrl}/api/dahav/dashboard/previous?${q}`, { headers }).then((r) => r.json()),
      ]);
      setSummary(d as DashboardSummary);
      setPrev(p as PreviousSummary);
    } catch (e) {
      setSummaryError("Unable to load dashboard data.");
    } finally {
      setSummaryLoading(false);
    }
  }, [pb.baseUrl, pb.authStore.token, period.from, period.to]);

  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    const q = `from=${period.from}&to=${period.to}`;
    try {
      const r = await fetch(`${pb.baseUrl}/api/dahav/dashboard/performance?${q}&granularity=${granularity}`, { headers });
      const j = await r.json();
      setPerf((j.rows || []) as SeriesPoint[]);
    } catch (e) {
      setPerf(null);
    } finally {
      setPerfLoading(false);
    }
  }, [pb.baseUrl, pb.authStore.token, period.from, period.to, granularity]);

  const loadTxns = useCallback(async () => {
    setTxnsLoading(true);
    try {
      const r = await fetch(`${pb.baseUrl}/api/dahav/dashboard/transactions?limit=8`, { headers });
      const j = await r.json();
      setTxns((j.rows || []) as RecentTxn[]);
    } catch (e) {
      setTxns([]);
    } finally {
      setTxnsLoading(false);
    }
  }, [pb.baseUrl, pb.authStore.token]);

  const loadDebtors = useCallback(async () => {
    setDebtorsLoading(true);
    try {
      const r = await fetch(`${pb.baseUrl}/api/dahav/reports/customer_debt`, { headers });
      const j = await r.json();
      setDebtors(((j.rows || []) as Debtor[]).filter((d) => d.outstanding > 0).slice(0, 5));
    } catch (e) {
      setDebtors([]);
    } finally {
      setDebtorsLoading(false);
    }
  }, [pb.baseUrl, pb.authStore.token]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const r = await fetch(`${pb.baseUrl}/api/dahav/dashboard/activity?limit=8`, { headers });
      const j = await r.json();
      setActivity((j.rows || []) as ActivityItem[]);
    } catch (e) {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [pb.baseUrl, pb.authStore.token]);

  useEffect(() => {
    setPeriod(periodFor(periodKey, customFrom || undefined, customTo || undefined));
  }, [periodKey, customFrom, customTo]);

  useEffect(() => {
    loadSummary();
    loadPerf();
  }, [loadSummary, loadPerf]);

  useEffect(() => {
    loadTxns();
    loadDebtors();
    loadActivity();
  }, [loadTxns, loadDebtors, loadActivity]);

  const switchPeriod = (k: PeriodKey) => {
    setPeriodKey(k);
    if (k !== "custom") setPeriod(periodFor(k));
  };

  const refreshAll = () => {
    loadSummary();
    loadPerf();
    loadTxns();
    loadDebtors();
    loadActivity();
  };

  const stockAlerts = summary ? [...summary.out_of_stock.map((p) => ({ ...p, status: "out" as const })), ...summary.low_stock.map((p) => ({ ...p, status: "low" as const }))] : [];

  const kpis = summary
    ? [
        { label: "Total Sales", value: usd(summary.revenue), sub: `${summary.sales_count} transaction(s)` },
        { label: "Expenses", value: usd(summary.expenses), sub: `${summary.expense_count} record(s)` },
        {
          label: "Net Profit",
          value: usd(summary.net_profit),
          sub: deltaPct(summary.net_profit, prev?.net_profit) ?? "after expenses & losses",
          danger: summary.net_profit < 0,
        },
        { label: "Outstanding", value: usd(summary.outstanding), sub: `${debtors ? debtors.length : "—"} customer(s) with debt`, danger: summary.outstanding > 0 },
      ]
    : [];

  return (
    <div className="dashboard">
      {/* Header — one quiet line */}
      <div className="dash-header">
        <div className="dash-title">
          <h1>{greeting(user)}</h1>
          <p className="sub">Here's an overview of your business.</p>
        </div>
        <div className="dash-controls">
          <div className="rate-chip" title="Default exchange rate">
            {summary ? rateLabel(summary.default_rate) : rateLabel(8000)}
          </div>
          <div className="period-bar">
            {PERIOD_SHORT.map((k) => (
              <button key={k} className={`chip ${periodKey === k ? "active" : ""}`} onClick={() => switchPeriod(k)}>
                {PERIOD_OPTIONS.find((o) => o.key === k)?.label}
              </button>
            ))}
            {periodKey === "custom" && (
              <>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" />
              </>
            )}
            <button className="btn small ghost" onClick={refreshAll} aria-label="Refresh" title="Refresh">
              <RefreshCw size={15} className={summaryLoading ? "busy-pulse" : ""} />
            </button>
          </div>
        </div>
      </div>

      {summaryLoading && !summary ? (
        <div className="grid cols-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : summaryError ? (
        <SectionError message={summaryError} onRetry={loadSummary} />
      ) : summary ? (
        <>
          {/* 4 quiet KPIs */}
          <div className="kpi-row">
            {kpis.map((k) => (
              <div className="card kpi" key={k.label}>
                <div className="kpi-label">{k.label}</div>
                <div className={`kpi-value ${k.danger ? "danger" : ""}`}>{k.value}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Financial statement — full width, one clean row */}
          <section className="statement">
            <div className="statement-head">
              <h2>Financial Statement</h2>
              <span className="muted small">{periodLabel(period)}</span>
            </div>
            <div className="statement-row">
              <div className="statement-col">
                <span>Revenue</span>
                <strong>{usd(summary.revenue)}</strong>
              </div>
              <div className="statement-op">−</div>
              <div className="statement-col">
                <span>COGS</span>
                <strong>{usd(summary.cogs)}</strong>
              </div>
              <div className="statement-op">=</div>
              <div className="statement-col">
                <span>Gross Profit</span>
                <strong>{usd(summary.gross_profit)}</strong>
              </div>
              <div className="statement-op">−</div>
              <div className="statement-col">
                <span>Expenses + Payroll + Damage</span>
                <strong>{usd(summary.expenses + summary.payroll + summary.damage_loss)}</strong>
              </div>
              <div className="statement-op">=</div>
              <div className={`statement-col total ${summary.net_profit < 0 ? "negative" : ""}`}>
                <span>Net Profit</span>
                <strong>{usd(summary.net_profit)}</strong>
              </div>
            </div>
          </section>

          {/* Sales trend (60%) + recent transactions (40%) */}
          <div className="dash-cols wide">
            <section className="card panel">
              <div className="panel-head">
                <h2>Sales Trend</h2>
                <div className="granularity-bar">
                  {(["day", "week", "month"] as const).map((g) => (
                    <button key={g} className={`chip small ${granularity === g ? "active" : ""}`} onClick={() => setGranularity(g)}>
                      {g[0].toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {perfLoading ? (
                <CardSkeleton rows={2} />
              ) : perf && perf.length > 0 ? (
                <TrendChart data={perf} />
              ) : (
                <EmptyState title="No sales data for this period." />
              )}
            </section>

            <section className="card panel">
              <div className="panel-head">
                <h2>Recent Transactions</h2>
                <Link to="/sales" className="btn small ghost">View all</Link>
              </div>
              {txnsLoading ? (
                <CardSkeleton rows={5} />
              ) : txns && txns.length > 0 ? (
                <div className="table-wrap">
                  <table className="mini-table">
                    <thead>
                      <tr><th>Date</th><th>Transaction</th><th>Customer</th><th>Amount</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {txns.map((t) => (
                        <tr key={t.transaction_id}>
                          <td className="muted">{new Date(t.date).toLocaleDateString()}</td>
                          <td>
                            <Link to={`/transactions/${t.link?.id ?? ""}`} className="txn-link">
                              <code>{t.transaction_id}</code>
                            </Link>
                          </td>
                          <td>{t.customer || "—"}</td>
                          <td className="money">
                            {t.original_currency === "SSP" ? (
                              <span className="money-ssp">{ssp(t.original_amount)}</span>
                            ) : (
                              <span className="money-usd">{usd(t.original_amount)}</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${t.status === "completed" || t.status === "paid" ? "green" : t.status === "credit" ? "blue" : t.status === "partial" ? "yellow" : "gray"}`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No transactions yet." />
              )}
            </section>
          </div>

          {/* Receivables (60%) + inventory alerts (40%) */}
          <div className="dash-cols wide">
            <section className="card panel">
              <div className="panel-head">
                <h2>Outstanding Balances</h2>
                <Link to="/customers" className="btn small ghost">Customers</Link>
              </div>
              {debtorsLoading ? (
                <CardSkeleton rows={4} />
              ) : debtors && debtors.length > 0 ? (
                <div className="table-wrap">
                  <table className="mini-table">
                    <thead>
                      <tr><th>Customer</th><th>Purchased</th><th>Paid</th><th>Outstanding</th></tr>
                    </thead>
                    <tbody>
                      {debtors.map((d) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td className="money">{usd(d.total_purchases)}</td>
                          <td className="money">{usd(d.total_paid)}</td>
                          <td className="money"><strong className="danger">{usd(d.outstanding)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No outstanding balances." />
              )}
            </section>

            <section className="card panel">
              <div className="panel-head">
                <h2>Inventory</h2>
                <Link to="/products" className="btn small ghost">Products</Link>
              </div>
              <div className="inventory-summary muted small">
                {summary.inventory_units} units · {usd(summary.inventory_value)} value
              </div>
              {stockAlerts.length > 0 ? (
                <div className="table-wrap">
                  <table className="mini-table">
                    <thead>
                      <tr><th>Product</th><th>Stock</th><th>Min</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {stockAlerts.map((p) => (
                        <tr key={p.product_id}>
                          <td>{p.name}</td>
                          <td>{p.stock}</td>
                          <td>{p.status === "low" ? p.low_stock_threshold : "—"}</td>
                          <td><span className={`badge ${p.status === "out" ? "red" : "yellow"}`}>{p.status === "out" ? "Out" : "Low"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ok-line"><AlertTriangle size={14} /> All products are sufficiently stocked.</div>
              )}
            </section>
          </div>

          {/* Recent activity — one quiet line list */}
          <section className="card panel activity-panel">
            <div className="panel-head">
              <h2>Recent Activity</h2>
            </div>
            {activityLoading ? (
              <CardSkeleton rows={3} />
            ) : activity && activity.length > 0 ? (
              <ul className="activity-list">
                {activity.map((a, i) => (
                  <li key={i}>
                    <span className={`activity-dot ${a.type}`} />
                    <span className="activity-text">
                      {a.description}
                      {a.transaction_id && <code> {a.transaction_id}</code>}
                    </span>
                    <span className="muted small activity-meta">
                      {a.user ? `${a.user} · ` : ""}
                      {new Date(a.date).toLocaleString()}
                      {a.amount !== 0 && <> · {usd(a.amount)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No recent activity." />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function periodLabel(p: Period): string {
  const f = new Date(p.from + "T00:00:00");
  const t = new Date(p.to + "T00:00:00");
  const sameYear = f.getFullYear() === t.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  if (p.from === p.to) return fmt(f, true);
  if (sameYear) return `${fmt(f, false)} – ${fmt(t, true)}`;
  return `${fmt(f, true)} – ${fmt(t, true)}`;
}
