import React, { RefObject } from "react";

interface PauseSubscriptionDialogProps {
  dialogRef: RefObject<HTMLDivElement>;
  pauseMode: "indefinite" | "until";
  pauseUntilInput: string;
  validationError: string | null;
  pending: boolean;
  onClose: () => void;
  onModeChange: (mode: "indefinite" | "until") => void;
  onDateChange: (value: string) => void;
  onConfirm: () => void;
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function PauseSubscriptionDialog({
  dialogRef,
  pauseMode,
  pauseUntilInput,
  validationError,
  pending,
  onClose,
  onModeChange,
  onDateChange,
  onConfirm,
}: PauseSubscriptionDialogProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-modal-title"
        data-testid="pause-dialog"
      >
        <h3 id="pause-modal-title">Pause subscription?</h3>
        <p>You won&apos;t be charged while paused.</p>

        <div className="form-group" role="radiogroup" aria-label="Pause duration">
          <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="pause-mode"
              checked={pauseMode === "indefinite"}
              onChange={() => onModeChange("indefinite")}
            />
            Pause indefinitely — resume manually
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input
              type="radio"
              name="pause-mode"
              checked={pauseMode === "until"}
              onChange={() => onModeChange("until")}
            />
            Pause until a specific date &amp; time
          </label>

          {pauseMode === "until" && (
            <div style={{ marginTop: 8 }}>
              <input
                type="datetime-local"
                className="input"
                data-testid="pause-until-input"
                aria-label="Resume date and time"
                value={pauseUntilInput}
                min={toDateTimeLocalValue(new Date(Date.now() + 60_000))}
                onChange={(event) => onDateChange(event.target.value)}
              />
              {validationError && (
                <span
                  className="error-message text-error"
                  role="alert"
                  data-testid="pause-until-error"
                  style={{ display: "block", marginTop: 4 }}
                >
                  {validationError}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            type="button"
            disabled={pending}
            className="btn-primary"
          >
            {pending ? "Pausing…" : "Pause"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CancelSubscriptionDialogProps {
  dialogRef: RefObject<HTMLDivElement>;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelSubscriptionDialog({
  dialogRef,
  loading,
  onClose,
  onConfirm,
}: CancelSubscriptionDialogProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
        data-testid="cancel-dialog"
      >
        <h3 id="cancel-modal-title">Cancel subscription?</h3>
        <p>Are you sure you want to cancel your subscription? This cannot be undone.</p>
        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">
            Back
          </button>
          <button onClick={onConfirm} type="button" disabled={loading} className="btn-danger">
            {loading ? "Cancelling…" : "Confirm Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
