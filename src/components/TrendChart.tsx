import { useMemo, useState } from "react";
import { usd } from "../lib/currency";

export interface SeriesPoint {
  label: string;
  revenue: number;
  cogs: number;
  gross_profit: number;
  sales_count: number;
}

/**
 * Minimal, dependency-free SVG bar/line chart for the dashboard.
 * Shows revenue (bars) + gross profit (line) over time.
 * Purposeful: communicates trend, not decoration.
 */
export function TrendChart({ data }: { data: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const PAD = { top: 16, right: 12, bottom: 28, left: 52 };

  const chart = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.cogs, d.gross_profit)));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = data.length > 1 ? innerW / (data.length - 1) : innerW;
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const x = (i: number) => PAD.left + (data.length > 1 ? i * step : innerW / 2);
    const barW = Math.max(3, Math.min(26, step * 0.5));
    const bars = data.map((d, i) => ({
      x: x(i) - barW / 2,
      y: y(Math.max(0, d.revenue)),
      h: Math.max(0, PAD.top + innerH - y(Math.max(0, d.revenue))),
      w: barW,
      cx: x(i),
    }));
    const line = data.map((d, i) => [x(i), y(Math.max(0, d.gross_profit))] as const);
    const path = line.map(([lx, ly], i) => `${i === 0 ? "M" : "L"}${lx.toFixed(1)},${ly.toFixed(1)}`).join(" ");
    return { bars, path, y, x, innerW, innerH, max };
  }, [data]);

  if (!data.length) {
    return <div className="empty">No sales recorded for this period.</div>;
  }

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Revenue and gross profit over time"
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = PAD.top + chart.innerH * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} className="chart-grid" />
              <text x={PAD.left - 6} y={gy + 3} className="chart-axis-label" textAnchor="end">
                {chart.max >= 1000 ? `$${Math.round(chart.max * (1 - f) / 1000)}k` : usd(chart.max * (1 - f))}
              </text>
            </g>
          );
        })}
        {/* revenue bars */}
        {chart.bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={2}
            className="chart-bar"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {/* gross profit line */}
        {data.length > 1 && <path d={chart.path} fill="none" className="chart-line" />}
        {data.length > 1 &&
          chart.bars.map((b, i) => (
            <circle key={i} cx={b.cx} cy={data[i].gross_profit >= 0 ? chart.y(data[i].gross_profit) : chart.y(0)} r={3} className="chart-dot" />
          ))}
        {/* x labels (sparse) */}
        {data.map((d, i) => {
          if (data.length > 12 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={chart.x(i)} y={H - 8} className="chart-axis-label" textAnchor="middle">
              {d.label}
            </text>
          );
        })}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: 0 }}>
          <strong>{hovered.label}</strong>
          <div>Revenue: {usd(hovered.revenue)}</div>
          <div>COGS: {usd(hovered.cogs)}</div>
          <div>Gross: {usd(hovered.gross_profit)}</div>
          <div className="muted small">{hovered.sales_count} sale(s)</div>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="legend-bar" /> Revenue</span>
        <span><i className="legend-line" /> Gross Profit</span>
      </div>
    </div>
  );
}

/** Horizontal bar breakdown (expenses by category, payment methods). */
export function HBarList({ items, currency = "USD" }: { items: Array<{ label: string; value: number; sub?: string }>; currency?: "USD" | "SSP" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="empty">No data for this period.</div>;
  return (
    <div className="hbar-list">
      {items.map((i) => (
        <div className="hbar-row" key={i.label}>
          <div className="hbar-label">
            <span>{i.label}</span>
            <strong>{currency === "SSP" ? `${Math.round(i.value).toLocaleString()} SSP` : usd(i.value)}</strong>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          {i.sub && <div className="muted small">{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}
