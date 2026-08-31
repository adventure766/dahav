import { ChevronLeft, ChevronRight } from "lucide-react";

/** Simple pagination control. */
export function Pagination({
  page, perPage, total, onPage,
}: { page: number; perPage: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn small ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={15} />
      </button>
      <span className="pagination-info">
        Page {page} of {pages} · {total} record(s)
      </span>
      <button className="btn small ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/** Sortable column header helper. */
export function SortHeader({
  label, k, sort, onSort,
}: { label: string; k: string; sort: string; onSort: (k: string) => void }) {
  const active = sort.replace("-", "") === k;
  const dir = sort.startsWith("-") ? "desc" : "asc";
  return (
    <th
      role="button"
      tabIndex={0}
      className={`sortable ${active ? "active" : ""}`}
      onClick={() => onSort(k)}
      onKeyDown={(e) => { if (e.key === "Enter") onSort(k); }}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} {active ? (dir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}
