interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small themed confirmation modal (window.confirm is unreliable in Tauri). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={danger ? "primary danger-btn" : "primary"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
