import React, { useEffect, useMemo, useState } from "react";
import { buildApproveTx, getAllowance, TOKEN_CONTRACT_ID, CONTRACT_ID } from "../stellar";
import { STROOPS_PER_XLM } from "../constants";
import { formatXlm } from "../utils/format";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./Toast";

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
  const [amount, setAmount] = useState<string>("0.0000000");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

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
        setAmount((Number(getRecommendedAllowance(subscriptionAmount, allowance)) / STROOPS_PER_XLM).toFixed(7));
      } catch {
        setCurrentAllowance(0n);
      }
    }

    loadAllowance();
  }, [userKey, subscriptionAmount]);

  async function handleSubmit() {
    setError(null);
    if (!amount) {
      setError("Please enter an amount to approve.");
      return;
    }

    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid XLM amount.");
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
      const stroops = BigInt(Math.round(parsed * STROOPS_PER_XLM));
      const xdr = await buildApproveTx(userKey, tokenContractId, CONTRACT_ID, stroops);
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
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h3>Increase Allowance</h3>
        <p>
          Current allowance: <strong>{formatXlm(currentAllowance ?? 0n)}</strong>.
          Recommended approval: <strong>{formatXlm(recommendedAllowance)}</strong>.
        </p>
        <label className="form-group">
          <span className="form-label">Approve total allowance (XLM)</span>
          <input
            type="number"
            min="0.0000001"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting}
          />
        </label>
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

function getRecommendedAllowance(subscriptionAmount: bigint, currentAllowance: bigint | null): bigint {
  const minimum = subscriptionAmount * 2n;
  if (currentAllowance === null || currentAllowance <= subscriptionAmount) {
    return minimum;
  }
  return currentAllowance + subscriptionAmount;
}
