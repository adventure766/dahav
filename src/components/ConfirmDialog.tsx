import { Trash2 } from "lucide-react";

/**
 * Reusable confirm dialog for destructive actions (delete/void).
 * Renders a modal asking the user to confirm before calling onConfirm.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = "Delete", busy = false, onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          <Trash2 size={18} style={{ verticalAlign: "-3px", marginRight: 8, color: "var(--danger)" }} />
          {title}
        </h2>
        <p className="muted">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
