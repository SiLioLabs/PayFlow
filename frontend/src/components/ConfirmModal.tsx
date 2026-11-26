import React, { useCallback, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  useTransactionPreview,
  type TransactionPreviewState,
} from "../hooks/useTransactionPreview";
import TransactionPreview from "./TransactionPreview";

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
  /** When provided, the transaction is simulated on open and previewed before confirming. */
  buildXdr?: (() => Promise<string>) | null;
  /** Externally managed preview state (used by panels that also submit the transaction). */
  previewState?: TransactionPreviewState | null;
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
  buildXdr = null,
  previewState = null,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const internal = useTransactionPreview(buildXdr, !!buildXdr && !previewState);
  const preview = previewState ?? internal;
  const blocked = confirmDisabled || preview.blocked;

  const handleConfirm = useCallback(() => {
    if (blocked) return;
    onConfirm();
  }, [blocked, onConfirm]);

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
        {(buildXdr || previewState) && (
          <TransactionPreview
            preview={preview.preview}
            loading={preview.loading}
            error={preview.error}
            override={preview.override}
            onOverrideChange={preview.setOverride}
          />
        )}
        {children}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} data-testid={cancelTestId}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleConfirm}
            disabled={blocked}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
