import React, { useCallback, useRef, useState } from "react";
import { useRegisterShortcuts } from "../context/ShortcutRegistry";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { friendlyError } from "../utils/errors";
import {
  CancelSubscriptionDialog,
  PauseSubscriptionDialog,
} from "./SubscriptionActionDialogs";

interface SubscriptionActionsProps {
  active: boolean;
  paused: boolean;
  healthUnhealthy: boolean;
  pausePending: boolean;
  pauseUntilPending: boolean;
  resumePending: boolean;
  cancelLoading: boolean;
  onPause: (expirySeconds: number | null) => Promise<boolean>;
  onResume: () => void;
  onCancel: () => Promise<boolean>;
  onTransfer: () => void;
}

export default function SubscriptionActions({
  active,
  paused,
  healthUnhealthy,
  pausePending,
  pauseUntilPending,
  resumePending,
  cancelLoading,
  onPause,
  onResume,
  onCancel,
  onTransfer,
}: SubscriptionActionsProps) {
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pauseMode, setPauseMode] = useState<"indefinite" | "until">("indefinite");
  const [pauseUntilInput, setPauseUntilInput] = useState("");
  const [pauseValidationError, setPauseValidationError] = useState<string | null>(null);
  const pauseDialogRef = useRef<HTMLDivElement>(null);
  const cancelDialogRef = useRef<HTMLDivElement>(null);
  const pauseTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closePauseDialog = useCallback(() => {
    setShowPauseConfirm(false);
    pauseTriggerRef.current?.focus();
    pauseTriggerRef.current = null;
  }, []);

  const closeCancelDialog = useCallback(() => {
    setShowCancelConfirm(false);
    cancelTriggerRef.current?.focus();
    cancelTriggerRef.current = null;
  }, []);

  const openPauseDialog = useCallback((trigger: HTMLButtonElement | null) => {
    pauseTriggerRef.current = trigger;
    setShowPauseConfirm(true);
  }, []);

  const openCancelDialog = useCallback((trigger: HTMLButtonElement | null) => {
    cancelTriggerRef.current = trigger;
    setShowCancelConfirm(true);
  }, []);

  useRegisterShortcuts(
    active
      ? [
          {
            key: "x",
            description: "Cancel active subscription",
            action: () => openCancelDialog(null),
          },
        ]
      : []
  );

  useFocusTrap(pauseDialogRef, showPauseConfirm, closePauseDialog);
  useFocusTrap(cancelDialogRef, showCancelConfirm, closeCancelDialog);

  const handlePauseConfirm = async () => {
    let expirySeconds: number | null = null;
    if (pauseMode === "until") {
      if (!pauseUntilInput) {
        setPauseValidationError("Choose a resume date and time.");
        return;
      }
      expirySeconds = Math.floor(new Date(pauseUntilInput).getTime() / 1000);
      if (!Number.isFinite(expirySeconds) || expirySeconds <= Math.floor(Date.now() / 1000)) {
        setPauseValidationError(friendlyError("error(contract, #27)"));
        return;
      }
    }

    setPauseValidationError(null);
    if (await onPause(expirySeconds)) closePauseDialog();
  };

  const handleCancelConfirm = async () => {
    if (await onCancel()) closeCancelDialog();
  };

  return (
    <>
      <div className="subscription-card__actions">
        {active && !paused && (
          <>
            <button
              onClick={(event) => openPauseDialog(event.currentTarget)}
              className="btn-secondary pause-btn"
              aria-label="Pause subscription"
              title={healthUnhealthy ? "Subscription needs attention" : undefined}
            >
              Pause
            </button>
            <button
              onClick={(event) => openCancelDialog(event.currentTarget)}
              className="btn-danger cancel-btn"
              aria-label="Cancel subscription"
              title={healthUnhealthy ? "Subscription needs attention" : undefined}
            >
              Cancel
            </button>
            <TransferButton onClick={onTransfer} />
          </>
        )}
        {active && paused && (
          <>
            <button
              onClick={onResume}
              disabled={resumePending}
              className="btn-primary resume-btn"
            >
              {resumePending ? "Resuming…" : "Resume"}
            </button>
            <button
              onClick={(event) => openCancelDialog(event.currentTarget)}
              className="btn-danger cancel-btn"
              aria-label="Cancel subscription"
            >
              Cancel
            </button>
            <TransferButton onClick={onTransfer} />
          </>
        )}
      </div>

      {showPauseConfirm && (
        <PauseSubscriptionDialog
          dialogRef={pauseDialogRef}
          pauseMode={pauseMode}
          pauseUntilInput={pauseUntilInput}
          validationError={pauseValidationError}
          pending={pausePending || pauseUntilPending}
          onClose={closePauseDialog}
          onModeChange={(mode) => {
            setPauseMode(mode);
            if (mode === "indefinite") setPauseValidationError(null);
          }}
          onDateChange={(value) => {
            setPauseUntilInput(value);
            setPauseValidationError(null);
          }}
          onConfirm={handlePauseConfirm}
        />
      )}

      {showCancelConfirm && (
        <CancelSubscriptionDialog
          dialogRef={cancelDialogRef}
          loading={cancelLoading}
          onClose={closeCancelDialog}
          onConfirm={handleCancelConfirm}
        />
      )}
    </>
  );
}

function TransferButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-secondary transfer-btn"
      aria-label="Transfer subscription ownership"
      data-testid="transfer-subscription-button"
    >
      Transfer
    </button>
  );
}
