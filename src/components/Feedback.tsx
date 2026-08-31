/** Lightweight loading skeleton row/block. */
export function Skeleton({ lines = 1, height = 14 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-block" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ height }} />
      ))}
    </div>
  );
}

/** Section-level loading placeholder for cards. */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card">
      <Skeleton lines={1} height={18} />
      <div style={{ height: 10 }} />
      <Skeleton lines={rows} height={13} />
    </div>
  );
}

/** Section error state with retry. */
export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="alert error" role="alert">
      <span>{message}</span>
      <button className="btn small" onClick={onRetry} style={{ marginLeft: 10 }}>
        Retry
      </button>
    </div>
  );
}

/** Empty state with an optional action. */
export function EmptyState({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {action && onAction && (
        <button className="btn small primary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
