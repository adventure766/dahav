/** Dashboard date-period presets + helpers. */

export type PeriodKey = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "this_year" | "custom";

export interface Period {
  key: PeriodKey;
  label: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

export function periodFor(key: PeriodKey, customFrom?: string, customTo?: string): Period {
  const now = new Date();
  switch (key) {
    case "today":
      return { key, label: "Today", from: iso(startOfDay(now)), to: iso(endOfDay(now)) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { key, label: "Yesterday", from: iso(startOfDay(y)), to: iso(endOfDay(y)) };
    }
    case "this_week":
      return { key, label: "This Week", from: iso(startOfWeek(now)), to: iso(endOfDay(now)) };
    case "this_month":
      return { key, label: "This Month", from: iso(startOfMonth(now)), to: iso(endOfDay(now)) };
    case "last_month": {
      const first = startOfMonth(now);
      first.setMonth(first.getMonth() - 1);
      return { key, label: "Last Month", from: iso(first), to: iso(endOfMonth(first)) };
    }
    case "this_year":
      return { key, label: "This Year", from: iso(startOfYear(now)), to: iso(endOfDay(now)) };
    case "custom":
    default: {
      const from = customFrom && customFrom <= (customTo || iso(now)) ? customFrom : iso(startOfMonth(now));
      const to = customTo && customTo >= from ? customTo : iso(endOfDay(now));
      return { key: "custom", label: "Custom Range", from, to };
    }
  }
}

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_year", label: "This Year" },
  { key: "custom", label: "Custom Range" },
];

/** Human label for a period: "Aug 1 – Aug 28, 2026". */
export function periodLabel(p: Period): string {
  const f = new Date(p.from + "T00:00:00");
  const t = new Date(p.to + "T00:00:00");
  const sameYear = f.getFullYear() === t.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  if (p.from === p.to) return fmt(f, true);
  if (sameYear) return `${fmt(f, false)} – ${fmt(t, true)}`;
  return `${fmt(f, true)} – ${fmt(t, true)}`;
}
