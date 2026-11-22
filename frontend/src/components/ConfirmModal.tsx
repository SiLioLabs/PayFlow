import React, { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional extra content (e.g. form fields) rendered between the message and actions. */
  children?: React.ReactNode;
  /** Disables the confirm button, e.g. while a bounded input is invalid. */
  confirmDisabled?: boolean;
  confirmTestId?: string;
  cancelTestId?: string;
  confirmLabel?: string;
}

export default function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
  confirmTestId,
  cancelTestId,
  confirmLabel = "Confirm",
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, true, onCancel);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-message"
      >
        <p id="confirm-modal-message">{message}</p>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} data-testid={cancelTestId}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={confirmDisabled}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
