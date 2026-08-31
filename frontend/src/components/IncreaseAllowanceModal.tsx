import React, { useEffect, useMemo, useState, useRef } from "react";
import { buildApproveTx, getAllowance, TOKEN_CONTRACT_ID, CONTRACT_ID } from "../stellar";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./Toast";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import StroopInput from "./StroopInput";

interface Props {
  userKey: string;
  subscriptionAmount: bigint;
  onSign: (xdr: string) => Promise<string>;
  onClose: () => void;
  onSuccess: () => void;
  announce: (message: string) => void;
}

export default function IncreaseAllowanceModal({
  userKey,
  subscriptionAmount,
  onSign,
  onClose,
  onSuccess,
  announce,
}: Props) {
  const [currentAllowance, setCurrentAllowance] = useState<bigint | null>(null);
  const [amountStroops, setAmountStroops] = useState<bigint | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();
  const { displayCurrentAmount } = useAmountDisplay();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, true, onClose);

  const tokenContractId = TOKEN_CONTRACT_ID;
  const recommendedAllowance = useMemo(
    () => getRecommendedAllowance(subscriptionAmount, currentAllowance),
    [subscriptionAmount, currentAllowance]
  );

  useEffect(() => {
    async function loadAllowance() {
      try {
        const allowance = await getAllowance(userKey);
        setCurrentAllowance(allowance);
        setAmountStroops(getRecommendedAllowance(subscriptionAmount, allowance));
      } catch {
        setCurrentAllowance(0n);
        setAmountStroops(getRecommendedAllowance(subscriptionAmount, 0n));
      }
    }

    loadAllowance();
  }, [userKey, subscriptionAmount]);

  async function handleSubmit() {
    setError(null);
    if (amountStroops === null) {
      setError("Please enter an amount to approve.");
      return;
    }

    if (!tokenContractId) {
      setError("VITE_TOKEN_CONTRACT_ID is not configured.");
      return;
    }

    if (!CONTRACT_ID) {
      setError("VITE_CONTRACT_ID is not configured.");
      return;
    }

    setSubmitting(true);
    announce("Submitting allowance approval transaction");

    try {
      const xdr = await buildApproveTx(userKey, tokenContractId, CONTRACT_ID, amountStroops);
      const hash = await onSign(xdr);
      addToast(`Allowance approved! tx: ${hash.slice(0, 12)}…`, "success");
      announce("Allowance updated successfully");
      onSuccess();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to approve allowance.";
      setError(message);
      addToast(`Error: ${message}`, "error");
      announce(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="increase-allowance-title"
      >
        <h3 id="increase-allowance-title">Increase Allowance</h3>
        <p>
          Current allowance: <strong>{displayCurrentAmount(currentAllowance ?? 0n)}</strong>.
        </p>
        <p>
          Recommended approval: <strong>{displayCurrentAmount(recommendedAllowance)}</strong>.
        </p>
        <p>
          Estimated billing cycles with new allowance:{" "}
          <strong>{Math.floor(Number(amountStroops || 0n) / Number(subscriptionAmount))}</strong>.
        </p>
        <StroopInput
          label="Total allowance"
          onChange={setAmountStroops}
          disabled={submitting}
          initialValue={recommendedAllowance}
        />
        {error && <p className="text-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Approving…" : "Approve Increase"}
          </button>
        </div>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </div>
  );
}

function getRecommendedAllowance(
  subscriptionAmount: bigint,
  currentAllowance: bigint | null
): bigint {
  const remainingCyclesTarget = 6n;
  const target = subscriptionAmount * remainingCyclesTarget;
  if (currentAllowance === null || currentAllowance < subscriptionAmount) {
    return target;
  }
  return target > currentAllowance ? target : currentAllowance + subscriptionAmount;
}
