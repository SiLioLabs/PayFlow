import React, { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmTestId?: string;
  cancelTestId?: string;
}

export default function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  confirmTestId,
  cancelTestId,
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
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} data-testid={cancelTestId}>
            Cancel
          </button>
          <button className="btn-danger" onClick={onConfirm} data-testid={confirmTestId}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
